CREATE TABLE "app_public"."permission_usage_coverage" (
	"guild_id" bigint PRIMARY KEY NOT NULL,
	"tracking_started_at" timestamp NOT NULL,
	"backfill_claimed_at" timestamp,
	"backfilled_at" timestamp,
	"backfill_coverage" jsonb
);

ALTER TABLE "app_public"."permission_usage_coverage" ENABLE ROW LEVEL SECURITY;
CREATE TABLE "app_public"."permission_usage" (
	"guild_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"permission" text NOT NULL,
	"source" text NOT NULL,
	"channel_id" bigint,
	"first_used_at" timestamp NOT NULL,
	"last_used_at" timestamp NOT NULL,
	"use_count" bigint NOT NULL,
	CONSTRAINT "permission_usage_pkey" PRIMARY KEY("guild_id","user_id","permission","source")
);

ALTER TABLE "app_public"."permission_usage" ENABLE ROW LEVEL SECURITY;
CREATE INDEX "permission_usage_last_used_at_idx" ON "app_public"."permission_usage" USING btree ("last_used_at");
CREATE INDEX "permission_usage_user_id_idx" ON "app_public"."permission_usage" USING btree ("user_id");
CREATE POLICY "admin_access" ON "app_public"."permission_usage_coverage" AS PERMISSIVE FOR ALL TO "sushii_admin" USING (true);
CREATE POLICY "admin_access" ON "app_public"."permission_usage" AS PERMISSIVE FOR ALL TO "sushii_admin" USING (true);