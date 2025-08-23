CREATE TABLE "app_public"."role_menu_messages" (
	"guild_id" bigint NOT NULL,
	"menu_name" text NOT NULL,
	"channel_id" bigint NOT NULL,
	"message_id" bigint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"needs_update" boolean DEFAULT false NOT NULL,
	CONSTRAINT "role_menu_messages_pkey" PRIMARY KEY("guild_id","menu_name","message_id")
);

ALTER TABLE "app_public"."role_menu_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app_public"."role_menu_messages" ADD CONSTRAINT "role_menu_messages_guild_id_menu_name_fkey" FOREIGN KEY ("guild_id","menu_name") REFERENCES "app_public"."role_menus"("guild_id","menu_name") ON DELETE cascade ON UPDATE cascade;
CREATE INDEX "idx_role_menu_messages_lookup" ON "app_public"."role_menu_messages" USING btree ("guild_id" int8_ops,"menu_name" text_ops);
CREATE POLICY "admin_access" ON "app_public"."role_menu_messages" AS PERMISSIVE FOR ALL TO "sushii_admin" USING (true);