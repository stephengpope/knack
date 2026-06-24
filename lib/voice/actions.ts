"use server";

import { getSession } from "@/lib/session";
import { getAssemblyaiKey } from "@/lib/settings";

/**
 * Mint a temporary AssemblyAI streaming token. The real key never reaches the
 * client. The token only needs to be valid at the WebSocket handshake — an
 * active stream keeps running after it expires — and `useVoiceInput` prefetches
 * + refreshes it, so the TTL is just headroom. 600s is the v3 maximum.
 */
export async function getVoiceTokenAction(): Promise<{
  token?: string;
  error?: string;
}> {
  const session = await getSession();
  if (!session?.user) return { error: "Unauthorized" };

  const apiKey = await getAssemblyaiKey();
  if (!apiKey) return { error: "Voice transcription not configured" };

  const res = await fetch(
    "https://streaming.assemblyai.com/v3/token?expires_in_seconds=600",
    { headers: { Authorization: apiKey } },
  );
  if (!res.ok) return { error: "Failed to get voice token" };

  const data = (await res.json()) as { token?: string };
  if (!data.token) return { error: "Failed to get voice token" };
  return { token: data.token };
}
