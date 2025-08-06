CREATE INDEX "idx_mod_logs_user_history" ON "app_public"."mod_logs" USING btree ("guild_id" int8_ops,"user_id" int8_ops,"action_time" timestamp_ops);
CREATE INDEX "idx_mod_logs_pending_cases" ON "app_public"."mod_logs" USING btree ("guild_id" int8_ops,"user_id" int8_ops,"action" text_ops,"pending" bool_ops,"action_time" timestamp_ops);
CREATE INDEX "idx_mod_logs_case_range" ON "app_public"."mod_logs" USING btree ("guild_id" int8_ops,"case_id" int8_ops);
CREATE INDEX "idx_mod_logs_guild_activity" ON "app_public"."mod_logs" USING btree ("guild_id" int8_ops,"action_time" timestamp_ops);
CREATE INDEX "idx_temp_bans_expires_at" ON "app_public"."temp_bans" USING btree ("expires_at" timestamp_ops);
CREATE INDEX "idx_temp_bans_guild_id" ON "app_public"."temp_bans" USING btree ("guild_id" int8_ops);