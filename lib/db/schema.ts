import {
  pgTable,
  text,
  timestamp,
  boolean,
  jsonb,
  integer,
  bigint,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/* ============================================================
 * Better Auth tables (field keys must match Better Auth models)
 * ============================================================ */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified")
    .$defaultFn(() => false)
    .notNull(),
  image: text("image"),
  // Better Auth admin plugin
  role: text("role"),
  banned: boolean("banned"),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  impersonatedBy: text("impersonated_by"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
});

/* ============================================================
 * App tables
 * ============================================================ */

export const chat = pgTable(
  "chat",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title"),
    starred: boolean("starred").default(false).notNull(),
    model: text("model"),
    // The full system prompt, assembled and frozen when the chat is created
    // (identity + guidance + skills + playbook + memory + user). Reused every
    // turn so we don't rebuild or rescan. Null only for chats created before
    // this column existed.
    systemPrompt: text("system_prompt"),
    // The GitHub-backed project this chat works in (chosen at creation). Null =
    // no project. Set null (not cascade) so deleting a project keeps the chat.
    projectId: text("project_id").references(() => project.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [index("chat_user_updated_idx").on(t.userId, t.updatedAt.desc())],
);

export const message = pgTable(
  "message",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => chat.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    parts: jsonb("parts").notNull(),
    idx: integer("idx").notNull(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [index("message_chat_idx").on(t.chatId, t.idx)],
);

// SHARED provider API keys (BYOK) for the whole deployment. Admins manage these
// in AI Models settings; all users use them. Value AES-256-GCM encrypted.
export const apiKey = pgTable(
  "api_key",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(), // "anthropic" | "openai" | ...
    encrypted: text("encrypted").notNull(), // iv:tag:ciphertext (base64)
    last4: text("last4").notNull(), // for masked display
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [uniqueIndex("api_key_provider_idx").on(t.provider)],
);

// DEPRECATED — superseded by the shared `appSettings`. Kept defined so the
// migration stays additive (avoids a destructive table rename). Not read/written.
export const userSettings = pgTable("user_settings", {
  userId: text("user_id").primaryKey(),
  connectionMode: text("connection_mode").default("gateway").notNull(),
  defaultModel: text("default_model")
    .default("anthropic/claude-opus-4.8")
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

// SHARED deployment model config (single row). Admin-managed; all users use it.
export const appSettings = pgTable("app_settings", {
  id: text("id").primaryKey(), // singleton key: "app"
  connectionMode: text("connection_mode").default("gateway").notNull(), // 'gateway' | 'custom' | 'compatible'
  defaultModel: text("default_model")
    .default("anthropic/claude-opus-4.8")
    .notNull(),
  // Lightweight model for background calls (e.g. chat titles). Null = "Same as
  // AI Agent" — fall back to defaultModel. Same connection mode as defaultModel.
  generalModel: text("general_model"),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

// SHARED OpenAI-compatible endpoints (direct, not via the gateway).
// API key AES-256-GCM encrypted at rest.
export const customEndpoint = pgTable("custom_endpoint", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  encrypted: text("encrypted").notNull(),
  model: text("model").notNull(),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

// PER-USER secrets vault. Two kinds in one table (discriminated by `kind`):
//  - 'static': a plain credential the user pastes; value in `encryptedValue`.
//  - 'oauth':  an OAuth2 connection; client creds + endpoints + the granted
//              token set, all encrypted. Re-auth updates the same row.
// All secret material AES-256-GCM encrypted at rest (lib/crypto.ts).
export const userSecret = pgTable(
  "user_secret",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // agent-facing identifier; unique per user
    description: text("description"),
    kind: text("kind").notNull(), // 'static' | 'oauth'

    // --- static ---
    encryptedValue: text("encrypted_value"), // iv:tag:ciphertext (base64)

    // --- oauth ---
    provider: text("provider"), // preset key ('google'…) or 'custom'
    clientId: text("client_id"),
    encryptedClientSecret: text("encrypted_client_secret"),
    authUrl: text("auth_url"), // authorization endpoint
    tokenUrl: text("token_url"), // token endpoint
    scopes: jsonb("scopes").$type<string[]>(),
    accountEmail: text("account_email"), // display only, from id_token
    encryptedAccessToken: text("encrypted_access_token"),
    encryptedRefreshToken: text("encrypted_refresh_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    tokenType: text("token_type"),
    status: text("status"), // 'disconnected' | 'connected' | 'expired'

    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [uniqueIndex("user_secret_user_name_idx").on(t.userId, t.name)],
);

// PER-USER GitHub connection (one row per user). The PAT is AES-256-GCM
// encrypted at rest; `login` is cached from GitHub on connect for display and
// commit identity. Validated against GET /user when (re)connected.
export const githubAccount = pgTable(
  "github_account",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    encryptedPat: text("encrypted_pat").notNull(), // iv:tag:ciphertext (base64)
    login: text("login").notNull(), // GitHub username
    githubUserId: bigint("github_user_id", { mode: "number" }), // for noreply email
    status: text("status").default("connected").notNull(), // 'connected' | 'invalid'
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [uniqueIndex("github_account_user_idx").on(t.userId)],
);

// PER-USER projects. Each maps 1:1 to a GitHub repo (created from the bundled
// template on creation). One project per user may be the default, used for new
// chats. Repo metadata is cached here; file contents always come from GitHub.
export const project = pgTable(
  "project",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    repoOwner: text("repo_owner").notNull(),
    repoName: text("repo_name").notNull(),
    repoFullName: text("repo_full_name").notNull(), // "owner/repo"
    defaultBranch: text("default_branch").default("main").notNull(),
    htmlUrl: text("html_url").notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [index("project_user_idx").on(t.userId)],
);

// Better Auth rate limiter (storage: "database").
export const rateLimit = pgTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key"),
  count: integer("count"),
  lastRequest: bigint("last_request", { mode: "number" }),
});

export type Chat = typeof chat.$inferSelect;
export type Message = typeof message.$inferSelect;
export type ApiKey = typeof apiKey.$inferSelect;
export type UserSettings = typeof userSettings.$inferSelect;
export type CustomEndpoint = typeof customEndpoint.$inferSelect;
export type UserSecret = typeof userSecret.$inferSelect;
export type GithubAccount = typeof githubAccount.$inferSelect;
export type Project = typeof project.$inferSelect;
