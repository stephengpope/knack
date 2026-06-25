import "server-only";
import { nanoid } from "nanoid";
import type { TelegramAccount } from "@/lib/db/schema";
import { listChats, createChat, getChat } from "@/lib/chats";
import { listProjects, getDefaultProject } from "@/lib/projects";
import { setActiveChat } from "@/lib/telegram-account";
import { TelegramClient, type BotCommand } from "@/lib/telegram/api";

// The /commands menu registered with Telegram (setMyCommands). Numbers in /chats
// and /projects refer to the position in the most-recent-first list.
export const BOT_COMMANDS: BotCommand[] = [
  { command: "new", description: "Start a new session (keeps the project)" },
  { command: "chats", description: "List your recent sessions" },
  { command: "chat", description: "Switch session: /chat <number>" },
  { command: "projects", description: "List your projects" },
  { command: "project", description: "Switch project (new session): /project <number>" },
  { command: "status", description: "Show the current session and project" },
  { command: "help", description: "Show available commands" },
];

const HELP = [
  "Commands:",
  "/new — start a new session (same project)",
  "/chats — list recent sessions",
  "/chat <n> — switch to session n",
  "/projects — list projects",
  "/project <n> — switch project (starts a new session)",
  "/status — current session + project",
  "/help — this message",
].join("\n");

const LIST_LIMIT = 20;

/**
 * Handle a slash command. Returns true if `text` was a command (and was
 * handled), false if it's an ordinary prompt the caller should run as a turn.
 */
export async function handleCommand(
  account: TelegramAccount,
  client: TelegramClient,
  text: string,
): Promise<boolean> {
  if (!text.startsWith("/")) return false;
  const userId = account.userId;
  const dm = account.dmChatId ?? account.authorizedTgUserId;
  const [raw, ...rest] = text.slice(1).trim().split(/\s+/);
  const cmd = raw.toLowerCase().split("@")[0]; // strip @botname in groups
  const arg = rest[0];
  const reply = (m: string) => client.sendMessage(dm, m);

  switch (cmd) {
    case "start":
    case "help":
      await reply(HELP);
      return true;

    case "new": {
      const current = account.activeChatId
        ? await getChat(userId, account.activeChatId)
        : null;
      const projectId =
        current?.projectId ?? (await getDefaultProject(userId))?.id ?? null;
      if (!projectId) {
        await reply("No project to use. Create one in the web app first.");
        return true;
      }
      await startSession(userId, projectId, dm);
      await reply("🆕 New session started.");
      return true;
    }

    case "chats": {
      const chats = (await listChats(userId)).slice(0, LIST_LIMIT);
      if (!chats.length) {
        await reply("No sessions yet. Send a message to start one.");
        return true;
      }
      const lines = chats.map(
        (c, i) =>
          `${i + 1}. ${c.title ?? "Untitled"}${
            c.id === account.activeChatId ? " ← current" : ""
          }`,
      );
      await reply(["Sessions (newest first):", ...lines, "", "Switch with /chat <number>"].join("\n"));
      return true;
    }

    case "chat": {
      const chats = (await listChats(userId)).slice(0, LIST_LIMIT);
      const idx = parseIndex(arg, chats.length);
      if (idx == null) {
        await reply("Usage: /chat <number> — see /chats for the list.");
        return true;
      }
      const target = chats[idx];
      await setActiveChat(userId, target.id);
      await reply(`Switched to: ${target.title ?? "Untitled"}`);
      return true;
    }

    case "projects": {
      const projects = await listProjects(userId);
      if (!projects.length) {
        await reply("No projects. Create one in the web app first.");
        return true;
      }
      const lines = projects.map((p, i) => `${i + 1}. ${p.name}${p.isDefault ? " (default)" : ""}`);
      await reply(["Projects:", ...lines, "", "Switch with /project <number>"].join("\n"));
      return true;
    }

    case "project": {
      const projects = await listProjects(userId);
      const idx = parseIndex(arg, projects.length);
      if (idx == null) {
        await reply("Usage: /project <number> — see /projects for the list.");
        return true;
      }
      const target = projects[idx];
      await startSession(userId, target.id, dm);
      await reply(`Switched to project ${target.name} — new session started.`);
      return true;
    }

    case "status": {
      const current = account.activeChatId
        ? await getChat(userId, account.activeChatId)
        : null;
      if (!current) {
        await reply("No active session. Send a message to start one.");
        return true;
      }
      const projects = await listProjects(userId);
      const proj = projects.find((p) => p.id === current.projectId);
      await reply(
        [
          `Session: ${current.title ?? "Untitled"}`,
          `Project: ${proj?.name ?? "—"}`,
        ].join("\n"),
      );
      return true;
    }

    default:
      await reply(`Unknown command: /${cmd}\n\n${HELP}`);
      return true;
  }
}

// Create a fresh, empty chat row on a project and point the conversation at it.
// runAgentTurn fills in the system prompt and title on the first message.
async function startSession(userId: string, projectId: string, dm: number) {
  const id = `chat-${nanoid()}`;
  await createChat(userId, {
    id,
    projectId,
    source: "telegram",
    sourceRef: String(dm),
  });
  await setActiveChat(userId, id);
}

// Parse a 1-based list index from a command arg; null if out of range / absent.
function parseIndex(arg: string | undefined, length: number): number | null {
  if (!arg) return null;
  const n = Number.parseInt(arg, 10);
  if (!Number.isInteger(n) || n < 1 || n > length) return null;
  return n - 1;
}
