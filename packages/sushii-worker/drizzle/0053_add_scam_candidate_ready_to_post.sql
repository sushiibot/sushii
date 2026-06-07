ALTER TYPE "app_public"."scam_candidate_review_status" ADD VALUE 'ready_to_post' BEFORE 'reviewing';
ALTER TABLE "app_public"."scam_candidate_state" ADD COLUMN "attachment_urls" text[] DEFAULT '{}'::text[] NOT NULL;
ALTER TABLE "app_public"."scam_candidate_state" ADD COLUMN "guild_names" text[] DEFAULT '{}'::text[] NOT NULL;