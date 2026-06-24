"use server";

import { getSession } from "@/lib/session";
import { runTaskHelperTurn } from "@/lib/task-helper/run";
import type { TaskHelperInput, TaskHelperResult } from "@/lib/task-helper/types";

export async function taskHelperTurnAction(
  input: TaskHelperInput,
): Promise<TaskHelperResult> {
  const session = await getSession();
  if (!session?.user) throw new Error("Unauthorized");
  return runTaskHelperTurn(input);
}
