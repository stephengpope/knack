ALTER TABLE "app_settings" ADD COLUMN "skill_review_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "skill_review_interval" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "iters_since_skill_review" integer DEFAULT 0 NOT NULL;