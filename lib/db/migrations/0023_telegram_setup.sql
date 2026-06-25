ALTER TABLE "chat" RENAME COLUMN "lease_until" TO "supervisor_lease_until";--> statement-breakpoint
CREATE TABLE "telegram_account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"encrypted_bot_token" text NOT NULL,
	"webhook_secret" text NOT NULL,
	"bot_username" text,
	"authorized_tg_user_id" bigint NOT NULL,
	"dm_chat_id" bigint,
	"active_chat_id" text,
	"last_update_id" bigint,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "chat_lease_until" timestamp;--> statement-breakpoint
ALTER TABLE "telegram_account" ADD CONSTRAINT "telegram_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_account" ADD CONSTRAINT "telegram_account_active_chat_id_chat_id_fk" FOREIGN KEY ("active_chat_id") REFERENCES "public"."chat"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_account_user_idx" ON "telegram_account" USING btree ("user_id");
