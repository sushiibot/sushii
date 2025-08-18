CREATE TABLE "app_public"."bot_emojis" (
	"name" text PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX "bot_emojis_name_idx" ON "app_public"."bot_emojis" USING btree ("name" text_ops);