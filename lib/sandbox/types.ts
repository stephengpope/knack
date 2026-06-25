// The one interface the whole app talks to. No tool/route ever imports a
// concrete sandbox SDK directly — only adapters under lib/sandbox/* do.
// Swap providers later = add an adapter, change nothing else.

export type RunResult = { stdout: string; stderr: string; exitCode: number };

export interface SandboxBox {
  run(cmd: string, args?: string[]): Promise<RunResult>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string | Buffer | Uint8Array): Promise<void>;
  listDir(path: string): Promise<string>;
  stop(): Promise<void>;
}

export interface Sandbox {
  // one box per chat (created on first use, reused while warm)
  getOrCreate(chatId: string): Promise<SandboxBox>;
}
