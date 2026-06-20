import "server-only";
import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import type { SandboxBox } from "@/lib/sandbox/types";
import { REPO_DIR } from "@/lib/prompt/paths";
import { resolveGeneralModel } from "@/lib/llm";

const MAX_STEPS = 12; // the seatbelt: if it can't finish in this many, give up

function inRepo(cmd: string): string[] {
  return ["-c", `cd ${REPO_DIR} && ${cmd}`];
}

/**
 * The LLM git-fixer. Invoked by gitSync when the mechanical path hits a merge
 * conflict or any git error it can't clear. Runs a bounded tool-loop with a
 * single `run_git` tool, with the goal of getting `branch` committed and pushed.
 * It owns all judgment-based recovery (resolve conflicts, abort broken states,
 * re-fetch/merge, deepen a shallow clone). The step cap is the only loop guard.
 *
 * Returns true only if, after the loop, the repo is genuinely clean + pushed
 * (verified independently — we never trust the model's word that it resolved).
 */
export async function gitFix(box: SandboxBox, branch: string): Promise<boolean> {
  try {
    const { model, providerOptions } = await resolveGeneralModel();
    await generateText({
      model,
      providerOptions,
      stopWhen: stepCountIs(MAX_STEPS),
      system:
        `You are recovering a git repository inside a sandbox at ${REPO_DIR}. ` +
        `Your only goal: get the branch "${branch}" committed and pushed to ` +
        `origin with a clean working tree. The remote "origin" already has ` +
        `credentials embedded, so push/fetch need no auth. ` +
        `Use the run_git tool to inspect and act. Strategy: run ` +
        `\`git status\` first; resolve any merge conflicts by editing files to ` +
        `keep both intents (remove all <<<<<<< ======= >>>>>>> markers) then ` +
        `stage and commit; abort hopelessly broken merges/rebases with ` +
        `\`git merge --abort\`/\`git rebase --abort\` and try a fresh ` +
        `fetch+merge; if a merge base is missing because the clone is shallow, ` +
        `run \`git fetch --unshallow\` (or \`--depth=100\`) and retry; finally ` +
        `\`git push origin ${branch}\`, re-fetching and merging if it is ` +
        `rejected. Stop as soon as \`git status\` is clean and the push ` +
        `succeeds. Do not run commands unrelated to this goal.`,
      prompt:
        `Recover branch "${branch}" and push it. Start by inspecting the ` +
        `current state.`,
      tools: {
        run_git: tool({
          description:
            "Run a shell command in the repo working directory. Returns " +
            "stdout, stderr, and exitCode. Use for all git/file operations.",
          inputSchema: z.object({
            cmd: z.string().describe("Shell command, e.g. `git status`."),
          }),
          execute: async ({ cmd }) => {
            const r = await box.run("bash", inRepo(cmd));
            return {
              stdout: r.stdout.slice(0, 8000),
              stderr: r.stderr.slice(0, 4000),
              exitCode: r.exitCode,
            };
          },
        }),
      },
    });
  } catch {
    // LLM/transport failure — fall through to the independent verification,
    // which will report not-clean and let gitSync mark the chat dirty.
  }

  return verifyCleanAndPushed(box, branch);
}

/** Trust nothing the model said — independently confirm the repo is clean,
 *  has no leftover conflict markers, and nothing is unpushed. */
async function verifyCleanAndPushed(
  box: SandboxBox,
  branch: string,
): Promise<boolean> {
  const status = await box.run("bash", inRepo("git status --porcelain"));
  if (status.stdout.trim().length > 0) return false;

  // Conflict markers committed into tracked files won't show in `status`.
  const markers = await box.run(
    "bash",
    inRepo("git grep -lE '^(<<<<<<<|=======|>>>>>>>)' -- . 2>/dev/null | head -1 || true"),
  );
  if (markers.stdout.trim().length > 0) return false;

  const ahead = await box.run(
    "bash",
    inRepo(`git rev-list origin/${branch}..HEAD --count 2>/dev/null || echo 1`),
  );
  return parseInt(ahead.stdout.trim() || "1", 10) === 0;
}
