ALTER TABLE "app_settings" ALTER COLUMN "max_output_tokens" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "app_settings" ALTER COLUMN "max_output_tokens" DROP NOT NULL;--> statement-breakpoint
UPDATE "app_settings" SET "max_output_tokens" = NULL WHERE "max_output_tokens" = 16384;
