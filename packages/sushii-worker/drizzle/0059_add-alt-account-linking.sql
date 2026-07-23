CREATE TABLE "app_public"."alt_identities" (
	"id" serial NOT NULL,
	"guild_id" bigint NOT NULL,
	"nickname" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "alt_identities_pkey" PRIMARY KEY("guild_id","id")
);

ALTER TABLE "app_public"."alt_identities" ENABLE ROW LEVEL SECURITY;
CREATE TABLE "app_public"."alt_identity_members" (
	"identity_id" integer NOT NULL,
	"guild_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"linked_by" bigint NOT NULL,
	"linked_at" timestamp DEFAULT now() NOT NULL,
	"reason" text,
	CONSTRAINT "alt_identity_members_pkey" PRIMARY KEY("guild_id","user_id")
);

ALTER TABLE "app_public"."alt_identity_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app_public"."alt_identity_members" ADD CONSTRAINT "alt_identity_members_guild_id_identity_id_fkey" FOREIGN KEY ("guild_id","identity_id") REFERENCES "app_public"."alt_identities"("guild_id","id") ON DELETE cascade ON UPDATE cascade;
CREATE INDEX "idx_alt_identity_members_identity" ON "app_public"."alt_identity_members" USING btree ("guild_id" int8_ops,"identity_id" int4_ops);
CREATE POLICY "admin_access" ON "app_public"."alt_identities" AS PERMISSIVE FOR ALL TO "sushii_admin" USING (true);
CREATE POLICY "admin_access" ON "app_public"."alt_identity_members" AS PERMISSIVE FOR ALL TO "sushii_admin" USING (true);