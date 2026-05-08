CREATE INDEX "user_levels_last_msg_idx" ON "app_public"."user_levels" USING btree ("last_msg");
CREATE MATERIALIZED VIEW "app_public"."global_user_level_rankings_all_time" AS (SELECT user_id, SUM(msg_all_time) AS total_xp, DENSE_RANK() OVER (ORDER BY SUM(msg_all_time) DESC, user_id DESC) AS rank FROM app_public.user_levels GROUP BY user_id);
CREATE MATERIALIZED VIEW "app_public"."global_user_level_rankings_day" AS (SELECT user_id, SUM(msg_day) AS total_xp, DENSE_RANK() OVER (ORDER BY SUM(msg_day) DESC, user_id DESC) AS rank FROM app_public.user_levels WHERE last_msg >= date_trunc('day', now()) AND last_msg < date_trunc('day', now()) + interval '1 day' GROUP BY user_id);
CREATE MATERIALIZED VIEW "app_public"."global_user_level_rankings_month" AS (SELECT user_id, SUM(msg_month) AS total_xp, DENSE_RANK() OVER (ORDER BY SUM(msg_month) DESC, user_id DESC) AS rank FROM app_public.user_levels WHERE last_msg >= date_trunc('month', now()) AND last_msg < date_trunc('month', now()) + interval '1 month' GROUP BY user_id);
CREATE MATERIALIZED VIEW "app_public"."global_user_level_rankings_week" AS (SELECT user_id, SUM(msg_week) AS total_xp, DENSE_RANK() OVER (ORDER BY SUM(msg_week) DESC, user_id DESC) AS rank FROM app_public.user_levels WHERE last_msg >= date_trunc('week', now()) AND last_msg < date_trunc('week', now()) + interval '1 week' GROUP BY user_id);

-- Indexes on materialized views (drizzle-kit does not generate these — appended manually per design decision 3)
CREATE UNIQUE INDEX ON app_public.global_user_level_rankings_all_time (user_id);
CREATE INDEX ON app_public.global_user_level_rankings_all_time (rank);
CREATE UNIQUE INDEX ON app_public.global_user_level_rankings_day (user_id);
CREATE INDEX ON app_public.global_user_level_rankings_day (rank);
CREATE UNIQUE INDEX ON app_public.global_user_level_rankings_week (user_id);
CREATE INDEX ON app_public.global_user_level_rankings_week (rank);
CREATE UNIQUE INDEX ON app_public.global_user_level_rankings_month (user_id);
CREATE INDEX ON app_public.global_user_level_rankings_month (rank);