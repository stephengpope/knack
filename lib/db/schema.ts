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
  pgSequence,
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
  // IANA timezone (e.g. "America/New_York") for rendering dates in the agent
  // prompt. Better Auth additionalFields-managed; defaults to UTC.
  timezone: text("timezone").default("UTC").notNull(),
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

// Global counter for the human-facing card ref (KNK-<n>). Assigned in
// createCard via nextval, so only cards consume numbers (gaps are fine).
export const cardSeqSequence = pgSequence("card_seq");

export const chat = pgTable(
  "chat",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title"),
    starred: boolean("starred").default(false).notNull(),
    // What triggered this chat. "user" = interactive; "cron" = a scheduled run.
    // Room for "api"/"webhook" later. `sourceRef` ties a run back to its
    // schedule (`projectId:jobName`) so all runs of one job can be grouped.
    source: text("source").default("user").notNull(),
    sourceRef: text("source_ref"),
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
    // Git sync state of the chat's sandbox repo, written by gitSync after each
    // turn. "clean" = committed + pushed; "dirty" = uncommitted/unpushed/failed
    // (work lives only in the sandbox, which auto-stops after ~5min). null =
    // never synced. `lastCommitSha` links the success indicator to the commit.
    gitState: text("git_state"),
    lastCommitSha: text("last_commit_sha"),
    lastSyncedAt: timestamp("last_synced_at"),

    // ---- Kanban card fields ----
    // A card IS a chat. The board is the set of chats with a non-null
    // kanbanStatus; null = an ordinary chat, not a card.
    kanbanStatus: text("kanban_status"), // todo|in_progress|blocked|review|done
    supervisorEnabled: boolean("supervisor_enabled").default(false).notNull(),
    cardSeq: integer("card_seq"), // KNK-<n> ref, from the card_seq sequence
    userStory: text("user_story"),
    details: text("details"), // freeform detailed brief
    acceptanceCriteria:
      jsonb("acceptance_criteria").$type<{ text: string; done: boolean }[]>(),
    tasks: jsonb("tasks").$type<{ text: string; done: boolean }[]>(),
    testCases: jsonb("test_cases").$type<
      { desc: string; status: "idle" | "running" | "pass" | "fail" }[]
    >(),
    // Which AI role last acted on the card (drives the card chip icon).
    activeRole: text("active_role"), // worker|supervisor
    blockedReason: text("blocked_reason"),

    // ---- Supervisor loop bookkeeping (per-RUN, reset on restart) ----
    iteration: integer("iteration").default(0).notNull(), // rounds in the current run
    runStartedAt: timestamp("run_started_at"), // marks the current run's budget window
    lastRunAt: timestamp("last_run_at"),
    leaseUntil: timestamp("lease_until"), // claim lock; tick won't re-dispatch until it passes
    maxRoundsOverride: integer("max_rounds_override"),
    maxTokensOverride: bigint("max_tokens_override", { mode: "number" }),

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

// Per-call token log for supervised cards. One row per AI call (worker turn or
// supervisor review). The budget guard sums tokens for the CURRENT run only
// (createdAt >= chat.runStartedAt), so a blocked card can be restarted with a
// fresh window. Indexed by (chatId, createdAt) for that sum.
export const usageEvent = pgTable(
  "usage_event",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => chat.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // 'worker' | 'supervisor'
    model: text("model"),
    inputTokens: integer("input_tokens").default(0).notNull(),
    outputTokens: integer("output_tokens").default(0).notNull(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [index("usage_event_chat_idx").on(t.chatId, t.createdAt)],
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

// SHARED global tokens (deployment-wide). Admins set these once and they cascade
// to every user via `secretGet` — a per-user `user_secret` of the same name wins.
// Tokens only (no OAuth). Value AES-256-GCM encrypted; `last4` for masked display.
export const globalSecret = pgTable(
  "global_secret",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(), // agent-facing identifier; unique deployment-wide
    description: text("description"),
    encrypted: text("encrypted").notNull(), // iv:tag:ciphertext (base64)
    last4: text("last4").notNull(), // for masked display
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [uniqueIndex("global_secret_name_idx").on(t.name)],
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
  // Supervisor budget ceilings (per card RUN). Cards may override per-card.
  maxRounds: integer("max_rounds").default(25).notNull(),
  maxTokensPerCard: bigint("max_tokens_per_card", { mode: "number" })
    .default(2_000_000)
    .notNull(),
  // Vercel Sandbox snapshot — the baked tools image (ripgrep + agent-browser +
  // firecrawl-cli + built-in skills). Built lazily on first sandbox creation and
  // self-healed if deleted; id lives here because Vercel env can't be written at
  // runtime. `status` ('building' | 'ready' | 'failed' | null) guards concurrent
  // builders via a compare-and-set. See lib/sandbox/snapshot-store.ts.
  sandboxSnapshotId: text("sandbox_snapshot_id"),
  sandboxSnapshotStatus: text("sandbox_snapshot_status"),
  // AssemblyAI streaming key for voice dictation (AES-256-GCM, iv:tag:ct). last4
  // kept for the admin display; decrypted only to mint a temp token. Unset → the
  // mic is hidden everywhere (voiceConfigured=false).
  assemblyaiKey: text("assemblyai_key"),
  assemblyaiKeyLast4: text("assemblyai_key_last4"),
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
    // Active projects run their cron schedules and appear in the chat selector.
    // Default true so existing projects stay active after the migration.
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [index("project_user_idx").on(t.userId)],
);

// CACHE of the schedules parsed from each project repo's `cron.json` — the
// dispatcher's working set. GitHub is the source of truth; this table lets the
// per-tick dispatch be one indexed query and lets a 304 (unchanged file) tick
// fire jobs without re-fetching. One row per (project, job name). `nextRunAt`
// is precomputed from `schedule`; the tick fires rows where it's <= now and
// recomputes it. `etag` is GitHub's ETag for the cron file (conditional GETs).
export const cronState = pgTable(
  "cron_state",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    jobName: text("job_name").notNull(),
    schedule: text("schedule").notNull(),
    prompt: text("prompt").notNull(),
    model: text("model"),
    enabled: boolean("enabled").default(true).notNull(),
    etag: text("etag"),
    nextRunAt: timestamp("next_run_at").notNull(),
    lastRunAt: timestamp("last_run_at"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("cron_state_project_job_idx").on(t.projectId, t.jobName),
    index("cron_state_due_idx").on(t.nextRunAt),
  ],
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
export type GlobalSecret = typeof globalSecret.$inferSelect;
export type UserSettings = typeof userSettings.$inferSelect;
export type CustomEndpoint = typeof customEndpoint.$inferSelect;
export type UserSecret = typeof userSecret.$inferSelect;
export type GithubAccount = typeof githubAccount.$inferSelect;
export type Project = typeof project.$inferSelect;
export type CronState = typeof cronState.$inferSelect;
