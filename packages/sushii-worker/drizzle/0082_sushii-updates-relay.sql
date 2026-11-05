CREATE TABLE "app_public"."sushii_update_deliveries" (
	"post_id" bigint NOT NULL,
	"guild_id" bigint NOT NULL,
	"status" text NOT NULL,
	"message_id" bigint,
	"error_code" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sushii_update_deliveries_pkey" PRIMARY KEY("post_id","guild_id"),
	CONSTRAINT "sushii_update_deliveries_status_check" CHECK ("app_public"."sushii_update_deliveries"."status" IN ('claimed', 'sent', 'failed', 'skipped', 'retry'))
);

CREATE TABLE "app_public"."sushii_update_intros" (
	"guild_id" bigint PRIMARY KEY NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "app_public"."sushii_update_posts" (
	"message_id" bigint PRIMARY KEY NOT NULL,
	"created_at" timestamp NOT NULL
);

ALTER TABLE "app_public"."guild_configs" ADD COLUMN "sushii_updates_enabled" boolean DEFAULT true NOT NULL;
ALTER TABLE "app_public"."sushii_update_deliveries" ADD CONSTRAINT "sushii_update_deliveries_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "app_public"."sushii_update_posts"("message_id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "sushii_update_deliveries_claimed_updated_at_idx" ON "app_public"."sushii_update_deliveries" USING btree ("updated_at") WHERE "app_public"."sushii_update_deliveries"."status" = 'claimed';
CREATE INDEX "sushii_update_posts_created_at_idx" ON "app_public"."sushii_update_posts" USING btree ("created_at");
ALTER TABLE "app_public"."guild_configs" DROP COLUMN "sushii_updates_webhook_id";
ALTER TABLE "app_public"."guild_configs" DROP COLUMN "sushii_updates_backfilled_at";