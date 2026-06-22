"use server";

import type { UIMessage } from "ai";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { getDefaultProject } from "@/lib/projects";
import {
  createCard,
  updateCard,
  removeFromBoard,
  setSupervise,
  type CardPatch,
} from "@/lib/board";
import { getSupervisorMessages } from "@/lib/supervisor/chat";

async function requireUser() {
  const session = await getSession();
  if (!session?.user) throw new Error("Unauthorized");
  return session.user.id;
}

export async function createCardAction(input: {
  title?: string;
  projectId?: string | null;
}) {
  const userId = await requireUser();
  // Project comes from the board filter; fall back to the user's default.
  let projectId = input.projectId ?? null;
  if (!projectId) {
    const def = await getDefaultProject(userId);
    projectId = def?.id ?? null;
  }
  const card = await createCard(userId, { title: input.title, projectId });
  revalidatePath("/board");
  return card;
}

export async function updateCardAction(id: string, patch: CardPatch) {
  await updateCard(await requireUser(), id, patch);
  revalidatePath("/board");
}

export async function removeFromBoardAction(id: string) {
  await removeFromBoard(await requireUser(), id);
  revalidatePath("/board");
  revalidatePath("/", "layout");
}

export async function setSuperviseAction(id: string, enabled: boolean) {
  await setSupervise(await requireUser(), id, enabled);
  revalidatePath("/board");
  revalidatePath("/", "layout");
}

export async function loadSupervisorChatAction(
  cardId: string,
): Promise<UIMessage[]> {
  return getSupervisorMessages(await requireUser(), cardId);
}
