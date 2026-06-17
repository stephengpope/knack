import "server-only";
import { headers } from "next/headers";
import {
  OAuth2Client,
  CodeChallengeMethod,
  generateState,
  generateCodeVerifier,
  type OAuth2Tokens,
} from "arctic";
import type { UserSecret } from "@/lib/db/schema";

// One fixed callback the user registers in their provider console.
export const OAUTH_CALLBACK_PATH = "/api/oauth/callback";

export type ProviderPreset = {
  id: string;
  label: string;
  authUrl?: string; // omitted for `custom` (user supplies)
  tokenUrl?: string;
  defaultScopes: string[];
  pkce: boolean;
  // extra params appended to the authorization URL (e.g. Google offline access)
  authParams?: Record<string, string>;
  custom?: boolean;
  // human note shown in the connect form
  hint?: string;
};

// Curated presets. Endpoints/scopes/quirks baked in (sourced from Arctic's
// provider definitions); the user always supplies their own client id + secret.
// `custom` lets them point at any other OAuth2 provider.
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "google",
    label: "Google",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    defaultScopes: ["openid", "email", "profile"],
    pkce: true,
    // offline + forced consent guarantee a refresh token (incl. on re-auth)
    authParams: { access_type: "offline", prompt: "consent" },
  },
  {
    id: "github",
    label: "GitHub",
    authUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    defaultScopes: ["read:user"],
    pkce: false,
    hint: "Classic OAuth apps issue long-lived tokens (no refresh).",
  },
  {
    id: "gitlab",
    label: "GitLab",
    authUrl: "https://gitlab.com/oauth/authorize",
    tokenUrl: "https://gitlab.com/oauth/token",
    defaultScopes: ["read_user"],
    pkce: true,
  },
  {
    id: "microsoft",
    label: "Microsoft",
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    defaultScopes: ["openid", "email", "profile", "offline_access", "User.Read"],
    pkce: true,
    authParams: { prompt: "consent" },
    hint: "Uses the multi-tenant 'common' endpoint.",
  },
  {
    id: "slack",
    label: "Slack",
    authUrl: "https://slack.com/openid/connect/authorize",
    tokenUrl: "https://slack.com/api/openid.connect.token",
    defaultScopes: ["openid", "email", "profile"],
    pkce: false,
  },
  {
    id: "discord",
    label: "Discord",
    authUrl: "https://discord.com/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
    defaultScopes: ["identify", "email"],
    pkce: false,
  },
  {
    id: "notion",
    label: "Notion",
    authUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    defaultScopes: [],
    pkce: false,
    authParams: { owner: "user" },
    hint: "Access is set on the Notion integration, not via scopes.",
  },
  {
    id: "linear",
    label: "Linear",
    authUrl: "https://linear.app/oauth/authorize",
    tokenUrl: "https://api.linear.app/oauth/token",
    defaultScopes: ["read"],
    pkce: false,
  },
  {
    id: "spotify",
    label: "Spotify",
    authUrl: "https://accounts.spotify.com/authorize",
    tokenUrl: "https://accounts.spotify.com/api/token",
    defaultScopes: ["user-read-email", "user-read-private"],
    pkce: true,
  },
  {
    id: "dropbox",
    label: "Dropbox",
    authUrl: "https://www.dropbox.com/oauth2/authorize",
    tokenUrl: "https://api.dropboxapi.com/oauth2/token",
    defaultScopes: ["account_info.read"],
    pkce: true,
    authParams: { token_access_type: "offline" }, // refresh token
  },
  {
    id: "figma",
    label: "Figma",
    authUrl: "https://www.figma.com/oauth",
    tokenUrl: "https://api.figma.com/v1/oauth/token",
    defaultScopes: ["file_read"],
    pkce: false,
  },
  {
    id: "atlassian",
    label: "Atlassian (Jira/Confluence)",
    authUrl: "https://auth.atlassian.com/authorize",
    tokenUrl: "https://auth.atlassian.com/oauth/token",
    defaultScopes: ["read:me", "offline_access"],
    pkce: false,
    authParams: { audience: "api.atlassian.com", prompt: "consent" },
  },
  {
    id: "twitch",
    label: "Twitch",
    authUrl: "https://id.twitch.tv/oauth2/authorize",
    tokenUrl: "https://id.twitch.tv/oauth2/token",
    defaultScopes: ["user:read:email"],
    pkce: false,
  },
  {
    id: "reddit",
    label: "Reddit",
    authUrl: "https://www.reddit.com/api/v1/authorize",
    tokenUrl: "https://www.reddit.com/api/v1/access_token",
    defaultScopes: ["identity"],
    pkce: false,
    authParams: { duration: "permanent" }, // refresh token
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    authUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    defaultScopes: ["openid", "profile", "email"],
    pkce: false,
  },
  {
    id: "custom",
    label: "Custom (any OAuth2 provider)",
    defaultScopes: [],
    pkce: true,
    custom: true,
    hint: "Paste the provider's authorization and token endpoint URLs.",
  },
];

export function getPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

/** Effective endpoints/scopes/flags for a stored connection row. */
export type ProviderConfig = {
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  pkce: boolean;
  authParams: Record<string, string>;
};

export function resolveProviderConfig(
  row: Pick<
    UserSecret,
    "provider" | "authUrl" | "tokenUrl" | "scopes"
  >,
): ProviderConfig {
  const scopes = row.scopes ?? [];
  if (row.provider === "custom") {
    if (!row.authUrl || !row.tokenUrl) {
      throw new Error("Custom provider is missing endpoint URLs");
    }
    return {
      authUrl: row.authUrl,
      tokenUrl: row.tokenUrl,
      scopes,
      pkce: true,
      authParams: {},
    };
  }
  const preset = getPreset(row.provider ?? "");
  if (!preset || !preset.authUrl || !preset.tokenUrl) {
    throw new Error(`Unknown OAuth provider: ${row.provider}`);
  }
  return {
    authUrl: preset.authUrl,
    tokenUrl: preset.tokenUrl,
    scopes: scopes.length ? scopes : preset.defaultScopes,
    pkce: preset.pkce,
    authParams: preset.authParams ?? {},
  };
}

/** Absolute redirect URI; canonical from APP_URL, else derived from the request. */
export async function oauthRedirectUri(): Promise<string> {
  const base = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (base) return new URL(OAUTH_CALLBACK_PATH, base).toString();
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}${OAUTH_CALLBACK_PATH}`;
}

export function buildClient(opts: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): OAuth2Client {
  return new OAuth2Client(opts.clientId, opts.clientSecret, opts.redirectUri);
}

/** Build the consent URL plus the state + PKCE verifier to stash in cookies. */
export function buildAuthorization(
  cfg: ProviderConfig,
  client: OAuth2Client,
): { url: URL; state: string; codeVerifier: string } {
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = cfg.pkce
    ? client.createAuthorizationURLWithPKCE(
        cfg.authUrl,
        state,
        CodeChallengeMethod.S256,
        codeVerifier,
        cfg.scopes,
      )
    : client.createAuthorizationURL(cfg.authUrl, state, cfg.scopes);
  for (const [k, v] of Object.entries(cfg.authParams)) {
    url.searchParams.set(k, v);
  }
  return { url, state, codeVerifier };
}

export function exchangeCode(
  cfg: ProviderConfig,
  client: OAuth2Client,
  code: string,
  codeVerifier: string,
): Promise<OAuth2Tokens> {
  return client.validateAuthorizationCode(
    cfg.tokenUrl,
    code,
    cfg.pkce ? codeVerifier : null,
  );
}

export function refreshTokens(
  cfg: ProviderConfig,
  client: OAuth2Client,
  refreshToken: string,
): Promise<OAuth2Tokens> {
  return client.refreshAccessToken(cfg.tokenUrl, refreshToken, []);
}

/** Best-effort account email from an OIDC id_token (display only). */
export function emailFromIdToken(idToken: string | null): string | null {
  if (!idToken) return null;
  try {
    const seg = idToken.split(".")[1];
    if (!seg) return null;
    const payload = JSON.parse(Buffer.from(seg, "base64url").toString("utf8"));
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}
