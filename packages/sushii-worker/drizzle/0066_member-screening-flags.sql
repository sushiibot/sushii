CREATE TABLE "app_public"."guild_feature_flags" (
	"guild_id" bigint NOT NULL,
	"flag" text NOT NULL,
	"enabled_by" bigint NOT NULL,
	"enabled_at" timestamp with time zone NOT NULL,
	CONSTRAINT "guild_feature_flags_guild_id_flag_pk" PRIMARY KEY("guild_id","flag"),
	CONSTRAINT "guild_feature_flags_flag_check" CHECK ("app_public"."guild_feature_flags"."flag" IN ('member_screening'))
);

ALTER TABLE "app_public"."screening_guilds" ADD COLUMN "enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "app_public"."screening_guilds" DROP COLUMN "enabled_by";
ALTER TABLE "app_public"."screening_guilds" DROP COLUMN "enabled_at";