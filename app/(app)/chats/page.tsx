import { requireUser } from "@/lib/session";
import { listChats } from "@/lib/chats";
import { ChatsList } from "@/components/chats/chats-list";

export default async function ChatsPage() {
  const user = await requireUser();
  const chats = await listChats(user.id);
  return <ChatsList chats={chats} />;
}
