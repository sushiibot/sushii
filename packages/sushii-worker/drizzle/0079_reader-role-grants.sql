-- Read-only access for services other than the bot. sushii-ansible creates these NOLOGIN roles and the
-- logins that are members of them; init.sql creates them for CI, tests and local databases.
GRANT USAGE ON SCHEMA "app_public" TO "sushii_logs_reader", "sushii_mcp_reader";
GRANT SELECT ON "app_public"."messages", "app_public"."cached_guilds", "app_public"."cached_users" TO "sushii_logs_reader";
GRANT SELECT ON "app_public"."mod_logs", "app_public"."cached_guilds", "app_public"."guild_bans", "app_public"."guild_configs" TO "sushii_mcp_reader";
