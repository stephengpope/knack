CREATE TABLE "app_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_mode" text DEFAULT 'gateway' NOT NULL,
	"default_model" text DEFAULT 'anthropic/claude-opus-4.8' NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_key" DROP CONSTRAINT "api_key_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "custom_endpoint" DROP CONSTRAINT "custom_endpoint_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "user_settings" DROP CONSTRAINT "user_settings_user_id_user_id_fk";
--> statement-breakpoint
DROP INDEX "api_key_user_provider_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_provider_idx" ON "api_key" USING btree ("provider");--> statement-breakpoint
ALTER TABLE "api_key" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "custom_endpoint" DROP COLUMN "user_id";