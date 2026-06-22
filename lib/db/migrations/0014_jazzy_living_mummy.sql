CREATE SEQUENCE "public"."card_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "usage_event" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"role" text NOT NULL,
	"model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "max_rounds" integer DEFAULT 25 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "max_tokens_per_card" bigint DEFAULT 2000000 NOT NULL;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "kanban_status" text;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "supervise_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "card_seq" integer;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "user_story" text;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "acceptance_criteria" jsonb;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "definition_of_done" jsonb;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "test_cases" jsonb;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "active_role" text;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "blocked_reason" text;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "iteration" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "run_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "last_run_at" timestamp;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "lease_until" timestamp;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "max_rounds_override" integer;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "max_tokens_override" bigint;--> statement-breakpoint
ALTER TABLE "usage_event" ADD CONSTRAINT "usage_event_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_event_chat_idx" ON "usage_event" USING btree ("chat_id","created_at");