import { cookies } from "next/headers";
import { getSession } from "@/lib/session";
import {
  getConnectionSecret,
  storeOAuthTokens,
} from "@/lib/user-secrets";
import {
  resolveProviderConfig,
  buildClient,
  exchangeCode,
  oauthRedirectUri,
} from "@/lib/oauth/providers";

function back(req: Request, params: Record<string, string>): Response {
  const url = new URL("/settings", req.url);
  url.searchParams.set("tab", "Secrets");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return Response.redirect(url, 303);
}

export async function GET(req: Request): Promise<Response> {
  const session = await getSession();
  if (!session?.user) return Response.redirect(new URL("/login", req.url), 303);
  const userId = session.user.id;

  const search = new URL(req.url).searchParams;
  const jar = await cookies();
  const state = jar.get("oauth_state")?.value;
  const verifier = jar.get("oauth_verifier")?.value;
  const cid = jar.get("oauth_cid")?.value;

  // one-shot: clear flow cookies regardless of outcome
  jar.delete("oauth_state");
  jar.delete("oauth_verifier");
  jar.delete("oauth_cid");

  const providerError = search.get("error");
  if (providerError) return back(req, { error: providerError });

  const code = search.get("code");
  const returnedState = search.get("state");
  if (!code || !returnedState || !state || returnedState !== state || !cid) {
    return back(req, { error: "invalid_request" });
  }

  const conn = await getConnectionSecret(userId, cid);
  if (!conn) return back(req, { error: "connection_not_found" });

  try {
    const cfg = resolveProviderConfig(conn.row);
    const client = buildClient({
      clientId: conn.row.clientId ?? "",
      clientSecret: conn.clientSecret,
      redirectUri: await oauthRedirectUri(),
    });
    const tokens = await exchangeCode(cfg, client, code, verifier ?? "");
    await storeOAuthTokens(userId, cid, tokens);
  } catch {
    return back(req, { error: "exchange_failed", connError: conn.row.name });
  }

  return back(req, { connected: conn.row.name });
}
