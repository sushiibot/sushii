ALTER TABLE "app_public"."mod_log_proofs" DROP CONSTRAINT "mod_log_proofs_source_check";
ALTER TABLE "app_public"."mod_log_proofs" ADD COLUMN "batch_id" uuid;
ALTER TABLE "app_public"."mod_log_proofs" ADD CONSTRAINT "mod_log_proofs_source_check" CHECK ("app_public"."mod_log_proofs"."source" IN ('action', 'button', 'command', 'context_menu', 'backfill', 'suggestion'));