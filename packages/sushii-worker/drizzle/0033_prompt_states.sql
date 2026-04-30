CREATE TABLE "app_public"."guild_prompt_states" (
	"guild_id" bigint NOT NULL,
	"prompt_id" text NOT NULL,
	"last_prompted_at" timestamp,
	"snooze_until" timestamp,
	"dismissed_at" timestamp,
	"completed_at" timestamp,
	CONSTRAINT "guild_prompt_states_pkey" PRIMARY KEY("guild_id","prompt_id")
);

ALTER TABLE "app_public"."guild_prompt_states" ENABLE ROW LEVEL SECURITY;
DROP POLICY "admin_access" ON "app_public"."guild_changelog_prompts" CASCADE;
DROP TABLE "app_public"."guild_changelog_prompts" CASCADE;
CREATE POLICY "admin_access" ON "app_public"."guild_prompt_states" AS PERMISSIVE FOR ALL TO "sushii_admin" USING (true);