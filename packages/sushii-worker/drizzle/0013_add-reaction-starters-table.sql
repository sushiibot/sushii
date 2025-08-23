CREATE TABLE "app_public"."reaction_starters" (
	"message_id" bigint NOT NULL,
	"emoji" text NOT NULL,
	"user_id" bigint NOT NULL,
	"guild_id" bigint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reaction_starters_pkey" PRIMARY KEY("message_id","emoji")
);

CREATE INDEX "reaction_starters_guild_idx" ON "app_public"."reaction_starters" USING btree ("guild_id");
CREATE INDEX "reaction_starters_created_at_idx" ON "app_public"."reaction_starters" USING btree ("created_at");