CREATE TABLE "app_public"."scam_image_hashes" (
	"id" serial PRIMARY KEY NOT NULL,
	"hash" bigint NOT NULL,
	"category" text,
	"label" text,
	"added_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "app_public"."scam_image_hashes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_access" ON "app_public"."scam_image_hashes" AS PERMISSIVE FOR ALL TO "sushii_admin" USING (true);