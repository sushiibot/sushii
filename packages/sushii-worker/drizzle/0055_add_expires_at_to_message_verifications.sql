ALTER TABLE "app_public"."message_verifications" ADD COLUMN "expires_at" timestamp with time zone;
UPDATE "app_public"."message_verifications" SET "expires_at" = "created_at" + interval '24 hours';
ALTER TABLE "app_public"."message_verifications" ALTER COLUMN "expires_at" SET NOT NULL;
ALTER TABLE "app_public"."message_verifications" ALTER COLUMN "expires_at" SET DEFAULT now() + interval '24 hours';
