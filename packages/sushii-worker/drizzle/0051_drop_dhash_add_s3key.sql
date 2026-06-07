ALTER TABLE "app_public"."scam_image_hashes" ALTER COLUMN "hash" DROP NOT NULL;
ALTER TABLE "app_public"."scam_image_hashes" ADD COLUMN "s3_key" text;