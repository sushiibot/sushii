CREATE TABLE "app_public"."message_log_posts" (
	"message_id" bigint PRIMARY KEY NOT NULL,
	"guild_id" bigint NOT NULL,
	"channel_id" bigint NOT NULL,
	"log_channel_id" bigint NOT NULL,
	"log_message_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "message_log_posts_created_at_idx" ON "app_public"."message_log_posts" USING btree ("created_at");