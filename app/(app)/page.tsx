import { nanoid } from "nanoid";
import { requireUser } from "@/lib/session";
import { getAvailableModels } from "@/lib/available-models";
import { Chat } from "@/components/chat/chat";

export default async function HomePage() {
  const user = await requireUser();
  const { models, defaultModel } = await getAvailableModels();
  const id = nanoid();
  return (
    <Chat
      id={id}
      initialMessages={[]}
      userName={user.name}
      initialModel={defaultModel}
      models={models}
    />
  );
}
