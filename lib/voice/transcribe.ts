import "server-only";
import { getAssemblyaiKey } from "@/lib/settings";

const BASE = "https://api.assemblyai.com/v2";
const POLL_INTERVAL_MS = 1500;
const MAX_POLLS = 60; // ~90s ceiling

/**
 * Transcribe audio (e.g. a Telegram voice note, OGG/Opus — accepted directly)
 * with AssemblyAI, using the app-level key. Returns null when no key is
 * configured (caller should tell the user voice isn't set up), or the
 * transcript text. Throws on a transcription failure.
 */
export async function transcribeAudio(
  audio: ArrayBuffer,
): Promise<string | null> {
  const key = await getAssemblyaiKey();
  if (!key) return null;

  const headers = { authorization: key };

  // 1. Upload the raw bytes.
  const up = await fetch(`${BASE}/upload`, {
    method: "POST",
    headers,
    body: audio,
  });
  if (!up.ok) throw new Error(`assemblyai upload failed (${up.status})`);
  const { upload_url } = (await up.json()) as { upload_url: string };

  // 2. Kick off transcription.
  const start = await fetch(`${BASE}/transcript`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ audio_url: upload_url }),
  });
  if (!start.ok) throw new Error(`assemblyai transcript failed (${start.status})`);
  const { id } = (await start.json()) as { id: string };

  // 3. Poll to completion.
  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS);
    const res = await fetch(`${BASE}/transcript/${id}`, { headers });
    if (!res.ok) continue;
    const data = (await res.json()) as {
      status: string;
      text?: string;
      error?: string;
    };
    if (data.status === "completed") return data.text?.trim() || "";
    if (data.status === "error") {
      throw new Error(data.error || "assemblyai transcription error");
    }
  }
  throw new Error("assemblyai transcription timed out");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
