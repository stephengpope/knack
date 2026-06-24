CREATE TABLE "global_secret" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"encrypted" text NOT NULL,
	"last4" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "global_secret_name_idx" ON "global_secret" USING btree ("name");