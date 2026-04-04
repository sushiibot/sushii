CREATE TABLE "app_public"."notification_user_settings" (
	"user_id" bigint NOT NULL,
	"ignore_unjoined_threads" boolean DEFAULT false NOT NULL,
	CONSTRAINT "notification_user_settings_pkey" PRIMARY KEY("user_id")
);

ALTER TABLE "app_public"."notification_user_settings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_access" ON "app_public"."notification_user_settings" AS PERMISSIVE FOR ALL TO "sushii_admin" USING (true);