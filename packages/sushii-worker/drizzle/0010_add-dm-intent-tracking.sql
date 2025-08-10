ALTER TABLE "app_public"."mod_logs" ADD COLUMN "dm_intended" boolean DEFAULT false NOT NULL;
ALTER TABLE "app_public"."mod_logs" ADD COLUMN "dm_intent_source" text DEFAULT 'unknown' NOT NULL;
ALTER TABLE "app_public"."mod_logs" ADD COLUMN "dm_attempted" boolean DEFAULT false NOT NULL;
ALTER TABLE "app_public"."mod_logs" ADD COLUMN "dm_not_attempted_reason" text;
ALTER TABLE "app_public"."mod_logs" ADD COLUMN "dm_failure_reason" text;