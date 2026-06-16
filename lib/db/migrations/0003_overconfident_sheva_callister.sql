CREATE INDEX "chat_user_updated_idx" ON "chat" USING btree ("user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "message_chat_idx" ON "message" USING btree ("chat_id","idx");