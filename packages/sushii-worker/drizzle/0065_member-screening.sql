CREATE TABLE "app_public"."screening_guilds" (
	"guild_id" bigint PRIMARY KEY NOT NULL,
	"log_channel_id" bigint,
	"max_messages" integer NOT NULL,
	"window_hours" integer NOT NULL,
	"review_threshold" double precision NOT NULL,
	"rules" text[],
	"check_avatars" boolean NOT NULL,
	"daily_check_cap" integer NOT NULL,
	"enabled_by" bigint NOT NULL,
	"enabled_at" timestamp with time zone NOT NULL
);

CREATE TABLE "app_public"."screening_verdicts" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" bigint NOT NULL,
	"channel_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"message_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"scores" jsonb,
	"categories" jsonb,
	"top_rule" text,
	"flagged" boolean DEFAULT false NOT NULL,
	"avatar_hash" text,
	"image_key" text,
	"source_url" text,
	"joined_at" timestamp with time zone,
	"ordinal" integer,
	"model" text,
	"cost" double precision,
	"judged" jsonb,
	"error" text,
	"post_channel_id" bigint,
	"post_message_id" bigint,
	"outcome" text,
	"outcome_by" bigint,
	"outcome_action" text,
	"ignore_reason" text,
	"outcome_at" timestamp with time zone,
	"message_deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "screening_verdicts_kind_check" CHECK ("app_public"."screening_verdicts"."kind" IN ('text', 'pfp', 'image', 'automod', 'miss')),
	CONSTRAINT "screening_verdicts_outcome_check" CHECK ("app_public"."screening_verdicts"."outcome" IN ('ignored', 'actioned')),
	CONSTRAINT "screening_verdicts_ignore_reason_check" CHECK ("app_public"."screening_verdicts"."ignore_reason" IN ('too_minor', 'allowed_here', 'not_violation', 'wrong_category'))
);

CREATE INDEX "screening_verdicts_created_at_idx" ON "app_public"."screening_verdicts" USING btree ("created_at");
CREATE INDEX "screening_verdicts_guild_id_created_at_idx" ON "app_public"."screening_verdicts" USING btree ("guild_id","created_at");
CREATE INDEX "screening_verdicts_guild_id_user_id_created_at_idx" ON "app_public"."screening_verdicts" USING btree ("guild_id","user_id","created_at");
CREATE INDEX "screening_verdicts_user_id_avatar_hash_idx" ON "app_public"."screening_verdicts" USING btree ("user_id","avatar_hash");
CREATE INDEX "screening_verdicts_guild_id_image_key_idx" ON "app_public"."screening_verdicts" USING btree ("guild_id","image_key");
CREATE INDEX "screening_verdicts_message_id_idx" ON "app_public"."screening_verdicts" USING btree ("message_id");
CREATE INDEX "screening_verdicts_post_message_id_idx" ON "app_public"."screening_verdicts" USING btree ("post_message_id");
CREATE INDEX "messages_guild_id_channel_id_created_idx" ON "app_public"."messages" USING btree ("guild_id","channel_id","created");
CREATE INDEX "messages_guild_id_author_id_created_idx" ON "app_public"."messages" USING btree ("guild_id","author_id","created");