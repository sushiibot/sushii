CREATE TABLE "app_public"."user_prompt_states" (
	"user_id" bigint NOT NULL,
	"prompt_id" text NOT NULL,
	"last_prompted_at" timestamp,
	"snooze_until" timestamp,
	"dismissed_at" timestamp,
	"completed_at" timestamp,
	CONSTRAINT "user_prompt_states_pkey" PRIMARY KEY("user_id","prompt_id")
);

CREATE INDEX "user_prompt_states_user_last_prompted_idx" ON "app_public"."user_prompt_states" USING btree ("user_id","last_prompted_at");