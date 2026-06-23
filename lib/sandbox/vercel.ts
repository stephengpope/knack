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
 * the snapshot is built lazily on first use and self-heals if deleted. When no
 * snapshot is available the box still works — it falls back to installing the
 * tools inline on creation (slower, but never blocks).
 */
export class VercelSandbox implements Sandbox {
  async getOrCreate(chatId: string): Promise<SandboxBox> {
    const name = `chat-${chatId}`;

    let { id } = await getSnapshot();
    if (!id) id = await this.ensureSnapshot();

    if (id) {
      const box = await this.boxFromSnapshot(name, id);
      if (box) return box;
      // snapshot turned out to be gone and rebuild failed — fall through.
    }

    return this.plainBox(name);
  }

  /** Reconnect an existing box, else create one from the snapshot. Returns null
   *  only when the snapshot is gone and a rebuild also fails. */
  private async boxFromSnapshot(
    name: string,
    snapshotId: string,
  ): Promise<SandboxBox | null> {
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
      // Snapshot deleted/expired — forget it, rebuild once, retry.
      await clearSnapshot();
      const rebuilt = await this.ensureSnapshot();
      if (!rebuilt) return null;
      return new VercelBox(
        await VercelSDK.create({
          name,
          source: { type: "snapshot", snapshotId: rebuilt },
          timeout: TTL_MS,
        }),
      );
    }
  }

  /** Plain node24 box; installs the tools inline on first creation (fallback
   *  path when no snapshot exists yet). Best-effort — a failed tool install
   *  must not break the box. */
  private async plainBox(name: string): Promise<SandboxBox> {
    const sb = await VercelSDK.getOrCreate({
      name,
      resume: true,
      runtime: "node24",
      timeout: TTL_MS,
      onCreate: async (s) => {
        for (const step of buildSteps()) {
          await s.runCommand("bash", ["-c", step.cmd]).catch(() => {});
        }
      },
    });
    return new VercelBox(sb);
  }

  /** Build the shared snapshot under a compare-and-set lock. Returns the id, or
   *  null if another builder holds the lock (caller falls back to a plain box)
   *  or the build failed. */
  private async ensureSnapshot(): Promise<string | null> {
    if (!(await acquireBuild())) {
      // Someone else is building (or just finished). Use theirs if ready.
      const { id, status } = await getSnapshot();
      return status === "ready" && id ? id : null;
    }
    try {
      const id = await this.buildSnapshot();
      await setReady(id);
      return id;
    } catch {
      await setFailed();
      return null;
    }
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
      const home = (await (await sb.runCommand("bash", ["-c", "echo -n $HOME"])).stdout()).trim();
      for (const s of vendoredSkills()) {
        const dir = `${home}/.skills/${s.name}`;
        await sb.runCommand("bash", ["-c", `mkdir -p '${dir}'`]);
        await sb.fs.writeFile(`${dir}/SKILL.md`, s.content);
      }
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
