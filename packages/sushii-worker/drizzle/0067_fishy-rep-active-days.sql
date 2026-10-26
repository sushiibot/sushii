ALTER TABLE "app_public"."users" ADD COLUMN "fishy_days_mask" integer DEFAULT 0 NOT NULL;
ALTER TABLE "app_public"."users" ADD COLUMN "fishy_days_anchor" integer;
ALTER TABLE "app_public"."users" ADD COLUMN "fishy_days_total" integer DEFAULT 0 NOT NULL;
ALTER TABLE "app_public"."users" ADD COLUMN "rep_days_mask" integer DEFAULT 0 NOT NULL;
ALTER TABLE "app_public"."users" ADD COLUMN "rep_days_anchor" integer;