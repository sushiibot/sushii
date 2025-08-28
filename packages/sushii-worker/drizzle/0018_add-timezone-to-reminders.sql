CREATE TABLE "app_public"."legacy_command_notifications" (
	"user_id" bigint PRIMARY KEY NOT NULL,
	"last_dm_sent" timestamp NOT NULL,
	"dm_count" integer DEFAULT 0 NOT NULL
);

ALTER TABLE "app_public"."legacy_command_notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app_public"."reminders" ALTER COLUMN "set_at" SET DATA TYPE timestamp with time zone;
ALTER TABLE "app_public"."reminders" ALTER COLUMN "expire_at" SET DATA TYPE timestamp with time zone;
CREATE INDEX "legacy_command_notifications_last_dm_idx" ON "app_public"."legacy_command_notifications" USING btree ("last_dm_sent");
CREATE POLICY "admin_access" ON "app_public"."legacy_command_notifications" AS PERMISSIVE FOR ALL TO "sushii_admin" USING (true);