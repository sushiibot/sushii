CREATE TABLE "app_public"."feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"guild_id" bigint,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"feature" text,
	"trace_id" text,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "feedback_user_id_created_at_idx" ON "app_public"."feedback" USING btree ("user_id","created_at");