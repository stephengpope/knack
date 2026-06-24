// The ONLY file allowed to import @vercel/sandbox.
import { Sandbox as VercelSDK } from "@vercel/sandbox";
import { dirname } from "node:path";
import type { Sandbox, SandboxBox, RunResult } from "./types";
import { buildSteps, smokeTests, vendoredSkills } from "./provision";
import {
  acquireBuild,
  clearSnapshot,
  getSnapshot,
  setFailed,
  setReady,
} from "./snapshot-store";

type SDKSandbox = Awaited<ReturnType<typeof VercelSDK.getOrCreate>>;

const TTL_MS = 5 * 60 * 1000;
// When another request is already building the snapshot, wait for it rather than
// hand back a half-equipped box. Poll the shared status until it resolves.
const BUILD_POLL_MS = 2000;
const BUILD_WAIT_MS = 4 * 60 * 1000;
// A snapshot build (chromium download + npm installs) runs minutes; give the
// build box room. NOTE: lazy builds run inside the agent request (maxDuration
// 300s) — a cold first build can exceed that. A stale 'building' lock is
// reclaimed by snapshot-store so a killed build doesn't wedge the deployment;
// the next request retries. Moving the build to after()/cron is a future option.
const BUILD_TTL_MS = 10 * 60 * 1000;

/** 404 from the sandbox API (box or snapshot not found). */
function apiStatus(e: unknown): number | undefined {
  return (e as { response?: { status?: number } })?.response?.status;
}
function isNotFound(e: unknown): boolean {
  return apiStatus(e) === 404;
}
/** A deleted/expired snapshot: 404 with body code 'not_found' (tested live). */
function isSnapshotGone(e: unknown): boolean {
  const code = (e as { json?: { error?: { code?: string } } })?.json?.error?.code;
  return apiStatus(e) === 404 && code === "not_found";
}

class VercelBox implements SandboxBox {
  constructor(private sb: SDKSandbox) {}

  async run(cmd: string, args: string[] = []): Promise<RunResult> {
    const r = await this.sb.runCommand(cmd, args);
    return {
      stdout: await r.stdout(),
      stderr: await r.stderr(),
      exitCode: r.exitCode ?? 0,
    };
  }

  // Native fs API — no shell, no path escaping concerns.
  readFile(path: string): Promise<string> {
    return this.sb.fs.readFile(path, "utf8");
  }

  async writeFile(path: string, content: string): Promise<void> {
    const dir = dirname(path);
    if (dir && dir !== "." && dir !== "/") {
      await this.sb.fs.mkdir(dir, { recursive: true });
    }
    await this.sb.fs.writeFile(path, content);
  }

  async listDir(path: string): Promise<string> {
    const entries = await this.sb.fs.readdir(path);
    return entries.join("\n");
  }

  async stop(): Promise<void> {
    await this.sb.stop();
  }
}

/**
 * One sandbox per chat, addressed by name. Fresh boxes boot from the shared
 * tools snapshot (ripgrep + agent-browser + firecrawl-cli + built-in skills);
 * the snapshot is built lazily on first use (the first turn blocks ~45s once) and
 * self-heals if deleted. Concurrent callers wait for an in-flight build. There is
 * no degraded fallback: every box is fully provisioned, or the turn throws — a box
 * missing its tools mid-session would corrupt the conversation.
 */
export class VercelSandbox implements Sandbox {
  async getOrCreate(chatId: string): Promise<SandboxBox> {
    const name = `chat-${chatId}`;
    const snapshotId = await this.readySnapshotId();
    return this.boxFromSnapshot(name, snapshotId);
  }

  /** The id of a ready snapshot — reuse one if present, else build it (or wait
   *  for an in-flight build). Throws if the build fails: a box must be fully
   *  provisioned or the turn fails loudly. There is no degraded fallback — a box
   *  missing its tools mid-session corrupts the conversation. */
  private async readySnapshotId(): Promise<string> {
    const { id, status } = await getSnapshot();
    if (id && status === "ready") return id;
    return this.ensureSnapshot();
  }

  /** Reconnect an existing box, else create one from the snapshot. Self-heals a
   *  deleted snapshot by rebuilding. Throws (never degrades) on failure. */
  private async boxFromSnapshot(
    name: string,
    snapshotId: string,
  ): Promise<SandboxBox> {
    // Reconnect a warm/existing box first — it's already provisioned.
    try {
      return new VercelBox(await VercelSDK.get({ name, resume: true }));
    } catch (e) {
      if (!isNotFound(e)) throw e; // transient/other — don't mask it
    }
    // No box yet — create one seeded from the snapshot.
    try {
      return new VercelBox(
        await VercelSDK.create({
          name,
          source: { type: "snapshot", snapshotId },
          timeout: TTL_MS,
        }),
      );
    } catch (e) {
      if (!isSnapshotGone(e)) throw e;
      // Snapshot deleted/expired — forget it, rebuild, retry once.
      await clearSnapshot();
      const rebuilt = await this.ensureSnapshot();
      return new VercelBox(
        await VercelSDK.create({
          name,
          source: { type: "snapshot", snapshotId: rebuilt },
          timeout: TTL_MS,
        }),
      );
    }
  }

  /** Write the vendored firecrawl skills (our own committed copies — not in the
   *  npm package) into $HOME/.skills. Shared by the snapshot build and the
   *  plain-box fallback so both paths get the full built-in set. */
  private async writeVendoredSkills(sb: SDKSandbox): Promise<void> {
    const home = (
      await (await sb.runCommand("bash", ["-c", "echo -n $HOME"])).stdout()
    ).trim();
    for (const s of vendoredSkills()) {
      const dir = `${home}/.skills/${s.name}`;
      await sb.runCommand("bash", ["-c", `mkdir -p '${dir}'`]);
      await sb.fs.writeFile(`${dir}/SKILL.md`, s.content);
    }
  }

  /** Build the shared snapshot under a compare-and-set lock. Returns the id, or
   *  null if another builder holds the lock (caller falls back to a plain box)
   *  or the build failed. */
  private async ensureSnapshot(): Promise<string> {
    if (await acquireBuild()) {
      try {
        const id = await this.buildSnapshot();
        await setReady(id);
        return id;
      } catch (e) {
        console.error("[snapshot] build failed:", (e as Error)?.stack ?? e);
        await setFailed();
        throw new Error(`Sandbox image build failed: ${(e as Error)?.message ?? e}`);
      }
    }
    // Another request holds the build lock — wait for it rather than degrade.
    return this.waitForReady();
  }

  /** Poll the shared status until a concurrent build resolves (or take over the
   *  lock if it was cleared/reset). Throws on failure or timeout. */
  private async waitForReady(): Promise<string> {
    const deadline = Date.now() + BUILD_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, BUILD_POLL_MS));
      const { id, status } = await getSnapshot();
      if (status === "ready" && id) return id;
      if (status === "failed") {
        throw new Error("Sandbox image build failed (in another request).");
      }
      if (status !== "building") {
        return this.ensureSnapshot(); // lock cleared — take it over
      }
    }
    throw new Error("Timed out waiting for the sandbox image to build.");
  }

  /** Provision a throwaway box, run the install steps + smoke tests, snapshot
   *  it. `snapshot()` stops the session, so this box is consumed here. */
  private async buildSnapshot(): Promise<string> {
    const sb = await VercelSDK.create({
      runtime: "node24",
      timeout: BUILD_TTL_MS,
    });
    try {
      for (const step of buildSteps()) {
        const r = await sb.runCommand("bash", ["-c", step.cmd]);
        if ((r.exitCode ?? 0) !== 0) {
          const err = (await r.stderr()).slice(0, 500);
          throw new Error(`snapshot build step '${step.label}' failed: ${err}`);
        }
      }
      // Write the vendored firecrawl skills (our own copies — not in the npm
      // package, never fetched at build) into $HOME/.skills.
      await this.writeVendoredSkills(sb);
      for (const t of smokeTests()) {
        const r = await sb.runCommand("bash", ["-c", t.cmd]);
        if ((r.exitCode ?? 0) !== 0) {
          const err = (await r.stderr()).slice(0, 500);
          throw new Error(`snapshot smoke test '${t.label}' failed: ${err}`);
        }
      }
      const snap = await sb.snapshot({ expiration: 0 }); // also stops the box
      return snap.snapshotId;
    } catch (e) {
      await sb.stop().catch(() => {}); // snapshot() not reached — clean up
      throw e;
    }
  }
}
