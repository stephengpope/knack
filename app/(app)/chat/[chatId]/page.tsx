import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { getChat, loadMessages } from "@/lib/chats";
import { getAvailableModels } from "@/lib/available-models";
import { Chat } from "@/components/chat/chat";

export default async function ChatPage({
  params,
}: {
  params: Promise<{ chatId: string }>;
}) {
  const { chatId } = await params;
  const user = await requireUser();

  // All three reads are independent — run them in one round-trip.
  const [chat, messages, { models, defaultModel }] = await Promise.all([
    getChat(user.id, chatId),
    loadMessages(chatId),
    getAvailableModels(),
  ]);
  if (!chat) notFound();

  return (
    <Chat
      id={chatId}
      initialMessages={messages}
      initialModel={chat.model ?? defaultModel}
      title={chat.title}
      starred={chat.starred}
      userName={user.name}
      models={models}
    />
  );
}
