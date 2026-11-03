CREATE TABLE "app_public"."mod_log_proofs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" bigint NOT NULL,
	"case_id" bigint NOT NULL,
	"author_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content" text,
	"attachments" text[] DEFAULT '{}'::text[] NOT NULL,
	"source_message_url" text,
	"source_author_id" bigint,
	"source_content" text,
	"host_message_id" bigint,
	"source" text NOT NULL,
	CONSTRAINT "mod_log_proofs_source_check" CHECK ("app_public"."mod_log_proofs"."source" IN ('action', 'button', 'command', 'context_menu', 'backfill'))
);

ALTER TABLE "app_public"."mod_log_proofs" ADD CONSTRAINT "mod_log_proofs_case_fkey" FOREIGN KEY ("guild_id","case_id") REFERENCES "app_public"."mod_logs"("guild_id","case_id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "mod_log_proofs_guild_id_case_id_created_at_idx" ON "app_public"."mod_log_proofs" USING btree ("guild_id","case_id","created_at");