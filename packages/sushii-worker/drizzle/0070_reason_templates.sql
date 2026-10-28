CREATE TABLE "app_public"."reason_templates" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" bigint NOT NULL,
	"shortcut" text,
	"content" text NOT NULL,
	"content_key" text NOT NULL,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"use_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone
);

ALTER TABLE "app_public"."mod_logs" ADD COLUMN "dm_deleted" boolean DEFAULT false NOT NULL;
ALTER TABLE "app_public"."mod_logs" ADD COLUMN "reason_set_by" bigint;
ALTER TABLE "app_public"."mod_logs" ADD COLUMN "reason_set_at" timestamp;
ALTER TABLE "app_public"."mod_logs" ADD COLUMN "dm_deleted_by" bigint;
ALTER TABLE "app_public"."mod_logs" ADD COLUMN "dm_deleted_at" timestamp;
CREATE UNIQUE INDEX "reason_templates_guild_id_shortcut_key" ON "app_public"."reason_templates" USING btree ("guild_id","shortcut") WHERE "app_public"."reason_templates"."shortcut" IS NOT NULL;
CREATE UNIQUE INDEX "reason_templates_guild_id_content_key_key" ON "app_public"."reason_templates" USING btree ("guild_id","content_key");
CREATE INDEX "reason_templates_guild_id_use_count_idx" ON "app_public"."reason_templates" USING btree ("guild_id","use_count" DESC NULLS LAST);