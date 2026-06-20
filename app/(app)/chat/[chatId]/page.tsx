import { requireUser } from "@/lib/session";
import { getChat, loadMessages } from "@/lib/chats";
import { listProjects, getDefaultProject } from "@/lib/projects";
import { Chat } from "@/components/chat/chat";

export default async function ChatPage({
  params,
}: {
  params: Promise<{ chatId: string }>;
}) {
  const { chatId } = await params;
  const user = await requireUser();

  // Independent reads — run them in one round-trip. A new chat's id has no row
  // yet (created on first message), so `chat` may be null — render it empty.
  const [chat, messages, projects, defaultProject] = await Promise.all([
    getChat(user.id, chatId),
    loadMessages(chatId),
    listProjects(user.id),
    getDefaultProject(user.id),
  ]);

  return (
    <Chat
      key={chatId}
      id={chatId}
      initialMessages={messages}
      title={chat?.title ?? null}
      starred={chat?.starred ?? false}
      userName={user.name}
      projects={projects}
      initialProjectId={chat ? chat.projectId : (defaultProject?.id ?? null)}
      initialGitState={chat?.gitState ?? null}
      initialGitSha={chat?.lastCommitSha ?? null}
    />
  );
}
