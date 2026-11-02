CREATE TYPE "app_public"."ip_grabber_domain_status" AS ENUM('active', 'stale', 'reverted');
CREATE TYPE "app_public"."ip_grabber_review_status" AS ENUM('pending', 'posted', 'reverted');
CREATE TABLE "app_public"."ip_grabber_domains" (
	"hostname" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"source" text NOT NULL,
	"status" "app_public"."ip_grabber_domain_status" DEFAULT 'active' NOT NULL,
	"first_seen_guild_id" text,
	"first_seen_guild_name" text,
	"first_seen_channel_id" text,
	"first_seen_channel_name" text,
	"review_status" "app_public"."ip_grabber_review_status" DEFAULT 'pending' NOT NULL,
	"review_message_id" text,
	"failed_checks" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app_public"."ip_grabber_guild_settings" (
	"guild_id" bigint PRIMARY KEY NOT NULL,
	"rule_id" bigint,
	"rule_name" text,
	"providers" text[] DEFAULT '{}'::text[] NOT NULL,
	"managed_keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error" text
);

CREATE INDEX "ip_grabber_domains_status_idx" ON "app_public"."ip_grabber_domains" USING btree ("status");
CREATE INDEX "ip_grabber_domains_review_status_idx" ON "app_public"."ip_grabber_domains" USING btree ("review_status");