CREATE TABLE "app_public"."scam_candidate_reviews" (
	"review_id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"user_id" text NOT NULL,
	"username" text NOT NULL,
	"review_channel_id" text NOT NULL,
	"review_message_id" text NOT NULL,
	"new_image_results" jsonb NOT NULL,
	"classification_result" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "app_public"."scam_candidate_sightings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"attachment_urls" text[] NOT NULL,
	"seen_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "app_public"."scam_candidate_state" (
	"key" text PRIMARY KEY NOT NULL,
	"next_notify_channel_threshold" integer DEFAULT 5 NOT NULL,
	"reviewing" boolean DEFAULT false NOT NULL,
	"ignored" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX "scam_candidate_sightings_key_seen_at_idx" ON "app_public"."scam_candidate_sightings" USING btree ("key","seen_at");