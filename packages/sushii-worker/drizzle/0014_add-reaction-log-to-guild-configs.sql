ALTER TABLE "app_public"."guild_configs" ADD COLUMN "log_reaction" bigint;
ALTER TABLE "app_public"."guild_configs" ADD COLUMN "log_reaction_enabled" boolean DEFAULT true NOT NULL;