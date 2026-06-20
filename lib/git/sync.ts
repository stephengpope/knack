import "server-only";
import { generateText } from "ai";
import type { RunResult, SandboxBox } from "@/lib/sandbox/types";
import { REPO_DIR } from "@/lib/prompt/paths";
import { resolveGeneralModel } from "@/lib/llm";
import type { GitState } from "@/lib/chats";
import { gitFix } from "./fix";

export type GitSyncResult = {
  state: GitState;
  sha?: string | null;
  message?: string;
};

const MSG_FILE = "/tmp/knack_commit_msg"; // outside REPO_DIR so it never dirties status
const FALLBACK_MSG = "Update workspace";

function inRepo(cmd: string): string[] {
  return ["-c", `cd ${REPO_DIR} && ${cmd}`];
}
function sh(box: SandboxBox, cmd: string): Promise<RunResult> {
  return box.run("bash", inRepo(cmd));
}

/** Retry a single command only on transport/network failure (≤2). A non-zero
 *  exit that isn't a transport error is returned as-is for the caller to judge. */
async function withTransportRetry(
  box: SandboxBox,
  cmd: string,
): Promise<RunResult> {
  let last = await sh(box, cmd);
  for (let i = 0; i < 2 && last.exitCode !== 0 && isTransport(last); i++) {
    await sleep(500 * (i + 1));
    last = await sh(box, cmd);
  }
  return last;
}
function isTransport(r: RunResult): boolean {
  return /could not resolve host|connection (timed out|reset|refused)|unable to access|network is unreachable|early eof|rpc failed/i.test(
    r.stderr,
  );
}
function isNonFastForward(r: RunResult): boolean {
  return /non-fast-forward|fetch first|tip of your current branch is behind|\[rejected\]/i.test(
    `${r.stderr}\n${r.stdout}`,
  );
}
function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Commit the chat's sandbox repo and push it to `branch`. Pure code on the
 * happy path; hands any merge conflict or unrecognized git error to the LLM
 * `gitFix`. Always resolves (never throws) with the repo's final state so the
 * caller can persist it. Safe to re-run: it re-checks state each call.
 */
export async function gitSync(
  box: SandboxBox,
  branch: string,
): Promise<GitSyncResult> {
  // 1. Anything to do? (dirty working tree OR local commits not yet pushed)
  const dirty = (await sh(box, "git status --porcelain")).stdout.trim().length > 0;
  const ahead =
    parseInt(
      (await sh(box, `git rev-list origin/${branch}..HEAD --count 2>/dev/null || echo 0`)).stdout.trim() || "0",
      10,
    ) > 0;
  if (!dirty && !ahead) return { state: "clean", sha: await head(box) };

  let message: string | undefined;

  // 2-3. Stage, build a message (LLM + fallback), commit.
  if (dirty) {
    await sh(box, "git add -A");
    message = await buildCommitMessage(box);
    await box.writeFile(MSG_FILE, message);
    const commit = await sh(box, `git commit -F ${MSG_FILE}`);
    // "nothing to commit" (race) is fine; a real failure → let fixer sort it.
    if (commit.exitCode !== 0 && !/nothing to commit/i.test(commit.stdout + commit.stderr)) {
      return finalize(box, branch, message, await gitFix(box, branch));
    }
  }

  // 4. Fetch, then merge if the remote moved.
  await withTransportRetry(box, `git fetch origin ${branch}`);
  if (await behind(box, branch)) {
    const merge = await sh(box, `git merge --no-edit origin/${branch}`);
    if (merge.exitCode !== 0) {
      return finalize(box, branch, message, await gitFix(box, branch));
    }
  }

  // 5-6. Push, with one mechanical reconcile on non-fast-forward, else fixer.
  let push = await withTransportRetry(box, `git push origin HEAD:${branch}`);
  if (push.exitCode !== 0) {
    if (isNonFastForward(push)) {
      await withTransportRetry(box, `git fetch origin ${branch}`);
      const merge = await sh(box, `git merge --no-edit origin/${branch}`);
      if (merge.exitCode === 0) {
        push = await withTransportRetry(box, `git push origin HEAD:${branch}`);
      }
    }
    if (push.exitCode !== 0) {
      return finalize(box, branch, message, await gitFix(box, branch));
    }
  }

  return finalize(box, branch, message, true);
}

async function buildCommitMessage(box: SandboxBox): Promise<string> {
  const stat = (await sh(box, "git diff --cached --stat | head -c 2000")).stdout;
  const diff = (await sh(box, "git diff --cached --unified=0 | head -c 6000")).stdout;
  try {
    const { model, providerOptions } = await resolveGeneralModel();
    const r = await generateText({
      model,
      providerOptions,
      maxOutputTokens: 120,
      system:
        "Write a concise git commit message for the staged diff: one " +
        "imperative subject line under 72 chars, optionally a short body. " +
        "Return ONLY the message, no backticks or quotes.",
      prompt: `Files:\n${stat}\n\nDiff:\n${diff}`,
    });
    const msg = r.text.replace(/^["'`#*\s]+|["'`\s]+$/g, "").trim();
    return msg || FALLBACK_MSG;
  } catch {
    return FALLBACK_MSG;
  }
}

/** Re-derive the repo's true state and shape the result. `pushedOk` is the
 *  caller's belief; we still verify the tree is clean and nothing is unpushed. */
async function finalize(
  box: SandboxBox,
  branch: string,
  message: string | undefined,
  pushedOk: boolean,
): Promise<GitSyncResult> {
  const sha = await head(box);
  const stillDirty = (await sh(box, "git status --porcelain")).stdout.trim().length > 0;
  const stillAhead = await aheadCount(box, branch);
  const clean = pushedOk && !stillDirty && stillAhead === 0;
  return { state: clean ? "clean" : "dirty", sha, message };
}

function head(box: SandboxBox): Promise<string> {
  return sh(box, "git rev-parse HEAD 2>/dev/null || echo").then((r) => r.stdout.trim());
}
async function behind(box: SandboxBox, branch: string): Promise<boolean> {
  const r = await sh(box, `git rev-list HEAD..origin/${branch} --count 2>/dev/null || echo 0`);
  return parseInt(r.stdout.trim() || "0", 10) > 0;
}
async function aheadCount(box: SandboxBox, branch: string): Promise<number> {
  const r = await sh(box, `git rev-list origin/${branch}..HEAD --count 2>/dev/null || echo 0`);
  return parseInt(r.stdout.trim() || "0", 10);
}
