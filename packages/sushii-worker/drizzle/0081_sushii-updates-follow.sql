ALTER TABLE "app_public"."guild_configs" ADD COLUMN "sushii_updates_webhook_id" bigint;
ALTER TABLE "app_public"."guild_configs" ADD COLUMN "sushii_updates_backfilled_at" timestamp;