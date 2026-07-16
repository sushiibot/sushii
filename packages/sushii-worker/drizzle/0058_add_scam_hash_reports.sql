CREATE TYPE "app_public"."scam_hash_report_status" AS ENUM('pending', 'posted', 'reverted', 'dismissed');
CREATE TABLE "app_public"."scam_hash_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"hash_id" integer NOT NULL,
	"reporter_id" text NOT NULL,
	"guild_id" text NOT NULL,
	"guild_name" text NOT NULL,
	"status" "app_public"."scam_hash_report_status" DEFAULT 'pending' NOT NULL,
	"review_message_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX "scam_hash_reports_status_idx" ON "app_public"."scam_hash_reports" USING btree ("status");