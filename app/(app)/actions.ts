"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { renameChat, deleteChat, toggleStar } from "@/lib/chats";

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
