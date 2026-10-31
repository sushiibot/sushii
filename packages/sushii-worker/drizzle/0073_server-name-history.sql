CREATE TABLE "app_public"."server_name_history" (
	"guild_id" bigint NOT NULL,
	"name" text NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "server_name_history_guild_id_name_pk" PRIMARY KEY("guild_id","name")
);

CREATE INDEX "server_name_history_guild_id_last_used_at_idx" ON "app_public"."server_name_history" USING btree ("guild_id","last_used_at" DESC NULLS LAST);