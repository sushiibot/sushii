CREATE TABLE "app_public"."schedule_channel_messages" (
	"guild_id" bigint NOT NULL,
	"channel_id" bigint NOT NULL,
	"year" smallint NOT NULL,
	"month" smallint NOT NULL,
	"message_index" smallint NOT NULL,
	"message_id" bigint NOT NULL,
	"content_hash" text DEFAULT '' NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"last_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_channel_messages_pkey" PRIMARY KEY("guild_id","channel_id","year","month","message_index")
);

CREATE TABLE "app_public"."schedule_channels" (
	"guild_id" bigint NOT NULL,
	"channel_id" bigint NOT NULL,
	"log_channel_id" bigint NOT NULL,
	"configured_by_user_id" bigint NOT NULL,
	"calendar_id" text NOT NULL,
	"calendar_title" text DEFAULT '' NOT NULL,
	"sync_token" text,
	"poll_interval_sec" integer DEFAULT 120 NOT NULL,
	"next_poll_at" timestamp with time zone NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_error_at" timestamp with time zone,
	"last_error_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_channels_pkey" PRIMARY KEY("guild_id","channel_id")
);

ALTER TABLE "app_public"."schedule_channel_messages" ADD CONSTRAINT "fk_schedule_channel" FOREIGN KEY ("guild_id","channel_id") REFERENCES "app_public"."schedule_channels"("guild_id","channel_id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "schedule_channel_messages_channel_idx" ON "app_public"."schedule_channel_messages" USING btree ("guild_id","channel_id");
CREATE INDEX "schedule_channels_next_poll_at_idx" ON "app_public"."schedule_channels" USING btree ("next_poll_at");