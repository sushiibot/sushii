CREATE TYPE "app_public"."scam_candidate_review_status" AS ENUM('claimed', 'reviewing', 'ignored', 'added');
DROP TABLE "app_public"."scam_candidate_reviews" CASCADE;
-- Reviews are ephemeral; existing state rows are incompatible with the new NOT NULL columns.
TRUNCATE TABLE "app_public"."scam_candidate_state";
ALTER TABLE "app_public"."scam_candidate_state" ADD COLUMN "status" "app_public"."scam_candidate_review_status" DEFAULT 'claimed' NOT NULL;
ALTER TABLE "app_public"."scam_candidate_state" ADD COLUMN "review_id" text NOT NULL;
ALTER TABLE "app_public"."scam_candidate_state" ADD COLUMN "triggered_by_user_id" text NOT NULL;
ALTER TABLE "app_public"."scam_candidate_state" ADD COLUMN "review_channel_id" text;
ALTER TABLE "app_public"."scam_candidate_state" ADD COLUMN "review_message_id" text;
ALTER TABLE "app_public"."scam_candidate_state" ADD COLUMN "channel_count" integer DEFAULT 0 NOT NULL;
ALTER TABLE "app_public"."scam_candidate_state" ADD COLUMN "guild_ids" text[] DEFAULT '{}'::text[] NOT NULL;
ALTER TABLE "app_public"."scam_candidate_state" ADD COLUMN "seen_by_user_ids" text[] DEFAULT '{}'::text[] NOT NULL;
ALTER TABLE "app_public"."scam_candidate_state" ADD COLUMN "new_image_results" jsonb;
ALTER TABLE "app_public"."scam_candidate_state" ADD COLUMN "classification_result" jsonb;
ALTER TABLE "app_public"."scam_candidate_state" ADD COLUMN "claimed_at" timestamp DEFAULT now() NOT NULL;
ALTER TABLE "app_public"."scam_candidate_state" DROP COLUMN "next_notify_channel_threshold";
ALTER TABLE "app_public"."scam_candidate_state" DROP COLUMN "reviewing";
ALTER TABLE "app_public"."scam_candidate_state" DROP COLUMN "ignored";
CREATE UNIQUE INDEX "scam_candidate_state_review_id_idx" ON "app_public"."scam_candidate_state" ("review_id");