CREATE TABLE "app_public"."guild_changelog_prompts" (
	"guild_id" bigint PRIMARY KEY NOT NULL,
	"last_prompted_at" timestamp,
	"snooze_until" timestamp,
	"dismissed_at" timestamp,
	"followed_at" timestamp
);

ALTER TABLE "app_public"."guild_changelog_prompts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_access" ON "app_public"."guild_changelog_prompts" AS PERMISSIVE FOR ALL TO "sushii_admin" USING (true);