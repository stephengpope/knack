CREATE TABLE "user_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"connection_mode" text DEFAULT 'gateway' NOT NULL,
	"default_model" text DEFAULT 'anthropic/claude-opus-4.8' NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;