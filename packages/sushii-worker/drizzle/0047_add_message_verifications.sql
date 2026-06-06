CREATE TABLE "app_public"."message_verifications" (
	"code" text PRIMARY KEY NOT NULL,
	"submitter_user_id" text NOT NULL,
	"message_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"author_id" text NOT NULL,
	"author_username" text NOT NULL,
	"content" text NOT NULL,
	"message_timestamp" timestamp with time zone NOT NULL,
	"attachments" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_verifications_submitter_message_unique" UNIQUE("submitter_user_id","message_id")
);