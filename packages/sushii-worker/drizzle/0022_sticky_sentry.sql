ALTER TABLE "app_public"."guild_configs" ADD COLUMN "kick_dm_text" text;
ALTER TABLE "app_public"."guild_configs" ADD COLUMN "kick_dm_enabled" boolean DEFAULT false NOT NULL;