ALTER TABLE "app_settings" ALTER COLUMN "max_output_tokens" SET DEFAULT 16384;--> statement-breakpoint
UPDATE "app_settings" SET "max_output_tokens" = 16384 WHERE "max_output_tokens" IS NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ALTER COLUMN "max_output_tokens" SET NOT NULL;