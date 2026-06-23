"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  isToolUIPart,
  type UIMessage,
} from "ai";
import {
  ChevronDown,
  Share,
  Star,
  Pencil,
  Trash2,
  FolderPlus,
  Shield,
} from "lucide-react";
import { setSuperviseAction } from "@/app/(app)/board/actions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  renameChatAction,
  deleteChatAction,
  toggleStarAction,
  getChatGitStatusAction,
} from "@/app/(app)/actions";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "@/components/ai-elements/reasoning";
import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Logomark } from "@/components/brand/logo";
import { KnackLoader } from "@/components/brand/loader";
import { addPendingChat, setChatTitleOverride } from "@/components/app/chat-store";
import {
  markChatGitStale,
  setChatGitStatus,
} from "@/components/app/git-status-store";
import { ProjectPicker } from "@/components/chat/project-picker";
import { GitCommitBadge } from "@/components/chat/git-commit-badge";
import type { ProjectSummary } from "@/lib/projects";

/**
 * After a turn, gitSync runs in the background (`after()`), so re-read this
 * chat's git status until a write newer than the pre-turn baseline appears, then
 * push it into the store. Both timestamps come from the DB (no clock skew). This
 * updates the sidebar dot + commit badge only — never the chat message window or
 * the layout. Best-effort: if it never settles, the value is correct on the next
 * navigation (the indicators also hydrate from server state).
 */
async function pollGitStatus(id: string) {
  let baseline = 0;
  try {
    const b = await getChatGitStatusAction(id);
    baseline = b.syncedAt ? new Date(b.syncedAt).getTime() : 0;
  } catch {
    // ignore
  }
  // Poll generously (~32s): gitSync can be slow when the commit-message model
  // lags, a push is slow, or the fixer runs. If it still doesn't land, the
  // indicators are correct on the next navigation anyway.
  for (let i = 0; i < 16; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const s = await getChatGitStatusAction(id);
      const t = s.syncedAt ? new Date(s.syncedAt).getTime() : 0;
      if (t > baseline) {
        setChatGitStatus(id, { state: s.state, sha: s.sha, fresh: true });
        return;
      }
    } catch {
      // ignore — reflects on next navigation
    }
  }
}

export function Chat({
  id,
  initialMessages,
  title,
  starred = false,
  userName,
  projects = [],
  initialProjectId = null,
  initialGitSha = null,
  initialSupervise = false,
}: {
  id: string;
  initialMessages: UIMessage[];
  title?: string | null;
  starred?: boolean;
  userName: string;
  projects?: ProjectSummary[];
  initialProjectId?: string | null;
  initialGitSha?: string | null;
  initialSupervise?: boolean;
}) {
  const router = useRouter();
  const [chatTitle, setChatTitle] = useState(title ?? "");
  const [isStarred, setIsStarred] = useState(starred);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(title ?? "");
  const [projectId, setProjectId] = useState<string | null>(initialProjectId);
  const [supervised, setSupervised] = useState(initialSupervise);
  const navigated = useRef(false);

  function toggleSupervise() {
    const next = !supervised;
    setSupervised(next);
    // Enabling promotes this chat to a board card (lands in Todo).
    setSuperviseAction(id, next);
  }

  function startRename() {
    setRenameValue(chatTitle);
    setRenaming(true);
  }
  function commitRename() {
    setRenaming(false);
    const next = renameValue.trim();
    if (next && next !== chatTitle) {
      setChatTitle(next);
      renameChatAction(id, next);
    }
  }
  function toggleStar() {
    setIsStarred((s) => !s);
    toggleStarAction(id);
  }
  function deleteChat() {
    router.push("/");
    deleteChatAction(id);
  }
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/agent",
        // Send only the new message; the server is the source of truth for
        // history (it reloads it from the DB). Keeps the payload small and
        // stops the client from dictating the conversation. `body` carries the
        // extras passed to sendMessage (e.g. projectId).
        prepareSendMessagesRequest({ id: reqId, messages: msgs, body }) {
          return {
            body: { id: reqId, message: msgs[msgs.length - 1], ...body },
          };
        },
      }),
    [],
  );

  const { messages, sendMessage, status, stop } = useChat({
    id,
    messages: initialMessages,
    transport,
    onData: (part) => {
      // Generated title streamed from the server — update the header and the
      // sidebar live, without re-rendering the chat.
      if (part.type === "data-chat-title" && typeof part.data === "string") {
        setChatTitle(part.data);
        setChatTitleOverride(id, part.data);
      }
    },
    onFinish: () => {
      // The turn's edits get committed by gitSync in the background; reflect the
      // result on the indicators once it settles.
      void pollGitStatus(id);
    },
  });

  const isWelcome = messages.length === 0;

  // Show the loader until the assistant produces real content. The stream flips
  // status to "streaming" on its opening chunk (before any token) and seeds an
  // empty text part, so we require non-empty text/reasoning (or a tool call).
  const last = messages[messages.length - 1];
  const awaitingReply =
    status === "submitted" ||
    (status === "streaming" &&
      !(
        last?.role === "assistant" &&
        last.parts.some(
          (p) =>
            (p.type === "text" && p.text.trim().length > 0) ||
            (p.type === "reasoning" && p.text.trim().length > 0) ||
            isToolUIPart(p),
        )
      ));

  function submit(message: PromptInputMessage) {
    const text = message.text?.trim();
    if (!text) return;
    if (isWelcome && !navigated.current) {
      navigated.current = true;
      // We're already at /chat/<id>; just surface it in the sidebar as "Untitled".
      addPendingChat({
        id,
        title: null,
        starred: false,
        updatedAt: new Date(),
        gitState: null,
        lastCommitSha: null,
        source: "user",
      });
    }
    // Fade the badge to grey for this turn — it keeps the last commit visible +
    // linkable and turns green again once the new turn's gitSync settles.
    markChatGitStale(id, initialGitSha);
    // projectId is only honored server-side on chat creation; for existing
    // chats the stored project wins. Sending it always is harmless.
    sendMessage({ text }, { body: { projectId } });
  }

  const composer = (
    <PromptInput
      onSubmit={submit}
      className="rounded-2xl border-input bg-card shadow-[0_14px_40px_-34px_var(--shadow)]"
    >
      <PromptInputBody>
        <PromptInputTextarea
          placeholder={isWelcome ? "How can I help you today?" : "Reply to Knack…"}
          autoFocus
        />
      </PromptInputBody>
      <PromptInputFooter>
        {projects.length > 0 ? (
          <ProjectPicker
            value={projectId ?? projects[0].id}
            onChange={setProjectId}
            projects={projects}
            disabled={!isWelcome}
          />
        ) : (
          isWelcome && (
            <Link
              href="/settings?tab=Projects"
              className="flex items-center gap-1.5 text-[13px] font-semibold text-primary outline-none transition-colors hover:underline"
            >
              <FolderPlus className="size-[14px]" />
              Add a project
            </Link>
          )
        )}
        <GitCommitBadge
          chatId={id}
          initialSha={initialGitSha}
          repoUrl={
            projects.find((p) => p.id === (projectId ?? projects[0]?.id))
              ?.htmlUrl ?? null
          }
        />
        <PromptInputSubmit
          status={status}
          onStop={stop}
          className="knack-gradient knack-glow ml-auto size-9 rounded-[11px] text-white"
        />
      </PromptInputFooter>
    </PromptInput>
  );

  if (isWelcome) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-10">
        <div className="mb-8 flex items-center gap-4">
          <Logomark size={38} strokeWidth={1.6} />
          <h1 className="font-heading text-[34px] font-semibold tracking-[-0.02em]">
            Hey there, {userName.split(" ")[0]}
          </h1>
        </div>
        <div className="w-full max-w-[780px]">{composer}</div>
      </div>
    );
  }

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-5">
        {renaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            className="min-w-0 max-w-[420px] flex-1 rounded-[9px] border border-primary bg-background px-2.5 py-1.5 text-[14.5px] font-bold outline-none"
          />
        ) : (
          <div className="flex min-w-0 items-center gap-0.5">
            <div
              onDoubleClick={startRename}
              title="Double-click to rename"
              className="-ml-2 min-w-0 truncate rounded-md px-2 py-1 text-[14.5px] font-bold transition-colors hover:bg-accent"
            >
              {chatTitle || "Untitled"}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                title="Chat options"
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-faint outline-none transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
              >
                <ChevronDown className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[168px]">
                <DropdownMenuItem onClick={toggleStar}>
                  <Star
                    className={cn(
                      "size-[15px]",
                      isStarred && "fill-primary text-primary",
                    )}
                  />
                  {isStarred ? "Unstar" : "Star"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={startRename}>
                  <Pencil className="size-[15px]" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onClick={deleteChat}>
                  <Trash2 className="size-[15px]" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {supervised && (
            <Link
              href={`/board?card=${id}`}
              className="flex h-[34px] items-center gap-1.5 rounded-[10px] border border-border bg-card px-3 text-[13px] font-semibold transition-colors hover:bg-accent"
            >
              View on board
            </Link>
          )}
          <button
            onClick={toggleSupervise}
            title={
              supervised
                ? "Autonomous supervision is on — click to turn off"
                : "Hand this chat to the autonomous supervisor (adds it to the board)"
            }
            className={cn(
              "flex h-[34px] items-center gap-1.5 rounded-[10px] border px-3 text-[13px] font-semibold transition-colors",
              supervised
                ? "border-green-600/30 bg-green-600/10 text-green-700"
                : "border-border bg-card hover:bg-accent",
            )}
          >
            <Shield className="size-[15px]" />
            {supervised ? "Supervising" : "Supervisor"}
          </button>
          <button
            onClick={() => toast("Sharing is coming soon")}
            className="flex h-[34px] items-center gap-1.5 rounded-[10px] border border-border bg-card px-3 text-[13px] font-semibold transition-colors hover:bg-accent"
          >
            <Share className="size-[15px]" /> Share
          </button>
        </div>
      </header>

      <Conversation>
        <ConversationContent className="mx-auto max-w-[780px]">
          {messages.map((m) => {
            if (m.role === "user") {
              return (
                <Message key={m.id} from="user">
                  <MessageContent>
                    {m.parts.map((part, i) =>
                      part.type === "text" ? (
                        <span key={i} className="whitespace-pre-wrap">
                          {part.text}
                        </span>
                      ) : null,
                    )}
                  </MessageContent>
                </Message>
              );
            }
            // Skip the assistant message until it has real content, so no empty
            // bubble flashes in before the first token (the loader covers that).
            const hasRenderable = m.parts.some(
              (p) =>
                (p.type === "text" && p.text.trim().length > 0) ||
                (p.type === "reasoning" && p.text.trim().length > 0) ||
                isToolUIPart(p),
            );
            if (!hasRenderable) return null;
            return (
              <div key={m.id} className="flex gap-3">
                <Message from="assistant" className="max-w-full flex-1">
                  <MessageContent>
                    {m.parts.map((part, i) => {
                      if (part.type === "text") {
                        return (
                          <MessageResponse key={i}>{part.text}</MessageResponse>
                        );
                      }
                      if (part.type === "reasoning") {
                        return (
                          <Reasoning
                            key={i}
                            isStreaming={status === "streaming"}
                          >
                            <ReasoningTrigger />
                            <ReasoningContent>{part.text}</ReasoningContent>
                          </Reasoning>
                        );
                      }
                      if (isToolUIPart(part)) {
                        const tp = part;
                        return (
                          <Tool key={i}>
                            <ToolHeader
                              type={tp.type as `tool-${string}`}
                              state={tp.state}
                            />
                            <ToolContent>
                              <ToolInput input={tp.input} />
                              <ToolOutput
                                output={tp.output}
                                errorText={tp.errorText}
                              />
                            </ToolContent>
                          </Tool>
                        );
                      }
                      return null;
                    })}
                  </MessageContent>
                </Message>
              </div>
            );
          })}
          {awaitingReply && (
            <div className="flex items-center gap-3">
              <KnackLoader size={30} className="shrink-0" />
              <div className="flex items-center gap-1.5 rounded-[14px] border border-input bg-muted px-4 py-3.5">
                {[0, 0.2, 0.4].map((d) => (
                  <span
                    key={d}
                    className="size-[7px] rounded-full bg-primary"
                    style={{ animation: `knack-blink 1.2s ${d}s infinite` }}
                  />
                ))}
              </div>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="px-6 pb-5 pt-1.5">
        <div className="mx-auto max-w-[780px]">{composer}</div>
      </div>
    </>
  );
}
