CREATE INDEX "reaction_starters_message_emoji_idx" ON "app_public"."reaction_starters" USING btree ("message_id","emoji");
ALTER TABLE "app_public"."reaction_starters" DROP CONSTRAINT "reaction_starters_pkey";
--> statement-breakpoint
ALTER TABLE "app_public"."reaction_starters" ADD CONSTRAINT "reaction_starters_pkey" PRIMARY KEY("message_id","emoji","user_id");