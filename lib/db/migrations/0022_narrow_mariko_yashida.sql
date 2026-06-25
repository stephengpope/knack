ALTER TABLE "app_settings" ADD COLUMN "smtp_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "smtp_host" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "smtp_port" integer;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "smtp_secure" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "smtp_user" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "smtp_pass" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "smtp_pass_last4" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "smtp_from" text;