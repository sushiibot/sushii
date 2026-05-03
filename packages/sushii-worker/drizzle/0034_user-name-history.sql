CREATE TYPE "app_public"."name_type" AS ENUM('username', 'global_name', 'nickname');
CREATE TABLE "app_public"."user_name_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"name_type" "app_public"."name_type" NOT NULL,
	"guild_id" bigint,
	"value" text,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX "idx_user_name_history_user" ON "app_public"."user_name_history" USING btree ("user_id","recorded_at" DESC NULLS LAST);