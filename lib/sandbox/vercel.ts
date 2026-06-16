// The ONLY file allowed to import @vercel/sandbox.
import { Sandbox as VercelSDK } from "@vercel/sandbox";
import { dirname } from "node:path";
import type { Sandbox, SandboxBox, RunResult } from "./types";

type SDKSandbox = Awaited<ReturnType<typeof VercelSDK.getOrCreate>>;

const TTL_MS = 5 * 60 * 1000;

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
 * One sandbox per chat, addressed by name. The SDK reconnects to the existing
 * session if it's still alive (resume) or creates a fresh one — no local cache,
 * no leak, works across function instances.
 */
export class VercelSandbox implements Sandbox {
  async getOrCreate(chatId: string): Promise<SandboxBox> {
    const sb = await VercelSDK.getOrCreate({
      name: `chat-${chatId}`,
      resume: true,
      runtime: "node24",
      timeout: TTL_MS,
    });
    return new VercelBox(sb);
  }
}
