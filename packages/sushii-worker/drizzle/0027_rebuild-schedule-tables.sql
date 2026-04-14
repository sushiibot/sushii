-- Drop old schedule tables (staging only — no data migration needed)
DROP TABLE IF EXISTS "app_public"."schedule_channel_messages";
DROP TABLE IF EXISTS "app_public"."schedule_channels";

-- schedules: keyed by (guild_id, calendar_id); channel_id is a unique column, not part of PK
CREATE TABLE "app_public"."schedules" (
	"guild_id" bigint NOT NULL,
	"calendar_id" text NOT NULL,
	"channel_id" bigint NOT NULL,
	"log_channel_id" bigint NOT NULL,
	"configured_by_user_id" bigint NOT NULL,
	"calendar_title" text DEFAULT '' NOT NULL,
	"display_title" text,
	"sync_token" text,
	"poll_interval_sec" integer DEFAULT 120 NOT NULL,
	"next_poll_at" timestamp with time zone NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_error_at" timestamp with time zone,
	"last_error_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedules_pkey" PRIMARY KEY("guild_id","calendar_id"),
	CONSTRAINT "schedules_channel_id_unique" UNIQUE("channel_id")
);

-- schedule_events: persisted calendar events, keyed by (guild_id, calendar_id, event_id)
CREATE TABLE "app_public"."schedule_events" (
	"guild_id" bigint NOT NULL,
	"calendar_id" text NOT NULL,
	"event_id" text NOT NULL,
	"summary" text NOT NULL,
	"start_utc" timestamp with time zone,
	"start_date" text,
	"is_all_day" boolean DEFAULT false NOT NULL,
	"url" text,
	"location" text,
	"status" text DEFAULT 'confirmed' NOT NULL,
	CONSTRAINT "schedule_events_pkey" PRIMARY KEY("guild_id","calendar_id","event_id")
);

-- schedule_messages: Discord messages for a schedule, keyed by (guild_id, calendar_id, year, month, message_index)
CREATE TABLE "app_public"."schedule_messages" (
	"guild_id" bigint NOT NULL,
	"calendar_id" text NOT NULL,
	"channel_id" bigint NOT NULL,
	"year" smallint NOT NULL,
	"month" smallint NOT NULL,
	"message_index" smallint NOT NULL,
	"message_id" bigint NOT NULL,
	"content_hash" text DEFAULT '' NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"last_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_messages_pkey" PRIMARY KEY("guild_id","calendar_id","year","month","message_index")
);

ALTER TABLE "app_public"."schedule_events"
	ADD CONSTRAINT "fk_schedule_events_schedule"
	FOREIGN KEY ("guild_id","calendar_id")
	REFERENCES "app_public"."schedules"("guild_id","calendar_id")
	ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "app_public"."schedule_messages"
	ADD CONSTRAINT "fk_schedule_messages_schedule"
	FOREIGN KEY ("guild_id","calendar_id")
	REFERENCES "app_public"."schedules"("guild_id","calendar_id")
	ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE INDEX "schedules_next_poll_at_idx" ON "app_public"."schedules" USING btree ("next_poll_at");
CREATE INDEX "schedule_events_calendar_start_idx" ON "app_public"."schedule_events" USING btree ("guild_id","calendar_id","start_utc");
CREATE INDEX "schedule_messages_calendar_idx" ON "app_public"."schedule_messages" USING btree ("guild_id","calendar_id");
