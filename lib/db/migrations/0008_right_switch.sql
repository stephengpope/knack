CREATE TABLE "user_secret" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" text NOT NULL,
	"encrypted_value" text,
	"provider" text,
	"client_id" text,
	"encrypted_client_secret" text,
	"auth_url" text,
	"token_url" text,
	"scopes" jsonb,
	"account_email" text,
	"encrypted_access_token" text,
	"encrypted_refresh_token" text,
	"access_token_expires_at" timestamp,
	"token_type" text,
	"status" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_secret" ADD CONSTRAINT "user_secret_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_secret_user_name_idx" ON "user_secret" USING btree ("user_id","name");