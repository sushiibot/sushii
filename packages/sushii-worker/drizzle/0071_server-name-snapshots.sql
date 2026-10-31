CREATE TABLE "app_public"."server_name_snapshots" (
	"guild_id" bigint PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"saved_by" bigint NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL
);
