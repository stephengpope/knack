import { redirect } from "next/navigation";
import { nanoid } from "nanoid";
import { requireUser } from "@/lib/session";

// New chats live at a real /chat/[id] URL. The root just mints a fresh id and
// forwards there so direct visits / post-login land on a proper chat page.
export default async function HomePage() {
  await requireUser();
  redirect(`/chat/${nanoid()}`);
}
