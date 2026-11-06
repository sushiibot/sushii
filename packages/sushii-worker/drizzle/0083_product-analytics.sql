CREATE TABLE "app_public"."product_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app_public"."product_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"feature" text NOT NULL,
	"guild_id" bigint,
	"actor" "bytea",
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE "app_public"."product_retention_weekly" (
	"cohort_week" date NOT NULL,
	"unit" text NOT NULL,
	"feature" text NOT NULL,
	"weeks_later" smallint NOT NULL,
	"base" integer,
	"retained" integer,
	CONSTRAINT "product_retention_weekly_pkey" PRIMARY KEY("cohort_week","unit","feature","weeks_later")
);

CREATE TABLE "app_public"."product_rollup_state" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"watermark" date NOT NULL,
	CONSTRAINT "product_rollup_state_single_row" CHECK ("app_public"."product_rollup_state"."id")
);

CREATE TABLE "app_public"."product_usage_weekly" (
	"week" date NOT NULL,
	"feature" text NOT NULL,
	"guilds" integer,
	"actors" integer,
	"events" integer NOT NULL,
	CONSTRAINT "product_usage_weekly_pkey" PRIMARY KEY("week","feature")
);

CREATE INDEX "product_events_occurred_at_idx" ON "app_public"."product_events" USING btree ("occurred_at");
CREATE INDEX "product_events_name_occurred_at_idx" ON "app_public"."product_events" USING btree ("name","occurred_at");
CREATE INDEX "product_events_actor_idx" ON "app_public"."product_events" USING btree ("actor");