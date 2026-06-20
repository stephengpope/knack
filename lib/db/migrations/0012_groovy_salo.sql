ALTER TABLE "chat" ADD COLUMN "git_state" text;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "last_commit_sha" text;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "last_synced_at" timestamp;