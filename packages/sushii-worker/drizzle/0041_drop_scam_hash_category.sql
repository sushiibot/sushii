UPDATE "app_public"."scam_image_hashes"
SET "label" = "category"
WHERE "label" IS NULL AND "category" IS NOT NULL;

ALTER TABLE "app_public"."scam_image_hashes" DROP COLUMN "category";