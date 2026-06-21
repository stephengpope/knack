CREATE TABLE "cron_state" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"job_name" text NOT NULL,
	"schedule" text NOT NULL,
	"prompt" text NOT NULL,
	"model" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"etag" text,
	"next_run_at" timestamp NOT NULL,
	"last_run_at" timestamp,
	"last_error" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "source" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "source_ref" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "cron_state" ADD CONSTRAINT "cron_state_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cron_state_project_job_idx" ON "cron_state" USING btree ("project_id","job_name");--> statement-breakpoint
CREATE INDEX "cron_state_due_idx" ON "cron_state" USING btree ("next_run_at");