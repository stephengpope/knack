"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import {
  renameChat,
  deleteChat,
  toggleStar,
  getChatGitStatus,
} from "@/lib/chats";

async function requireUser() {
  const session = await getSession();
  if (!session?.user) throw new Error("Unauthorized");
  return session.user.id;
}

export async function renameChatAction(id: string, title: string) {
  await renameChat(await requireUser(), id, title.trim() || "Untitled");
  revalidatePath("/", "layout");
}

export async function deleteChatAction(id: string) {
  await deleteChat(await requireUser(), id);
  revalidatePath("/", "layout");
}

export async function toggleStarAction(id: string) {
  await toggleStar(await requireUser(), id);
  revalidatePath("/", "layout");
}

/** Read a chat's git status for the post-turn live re-read. Deliberately does
 *  NOT revalidate — the git indicators update via the client store only, so this
 *  never re-runs the layout (keeps the sidebar and chat window independent). */
export async function getChatGitStatusAction(id: string) {
  return getChatGitStatus(await requireUser(), id);
}
