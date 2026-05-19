DROP MATERIALIZED VIEW "app_public"."global_user_level_rankings_all_time";
DROP MATERIALIZED VIEW "app_public"."global_user_level_rankings_day";
DROP MATERIALIZED VIEW "app_public"."global_user_level_rankings_month";
DROP MATERIALIZED VIEW "app_public"."global_user_level_rankings_week";
CREATE MATERIALIZED VIEW "app_public"."global_user_level_rankings_all_time" AS (SELECT user_id, SUM(msg_all_time) AS total_xp, SUM(msg_all_time) AS all_time_xp, DENSE_RANK() OVER (ORDER BY SUM(msg_all_time) DESC, user_id DESC) AS rank FROM app_public.user_levels GROUP BY user_id);
CREATE MATERIALIZED VIEW "app_public"."global_user_level_rankings_day" AS (SELECT filtered.user_id, filtered.total_xp, all_time.all_time_xp, DENSE_RANK() OVER (ORDER BY filtered.total_xp DESC, filtered.user_id DESC) AS rank FROM (SELECT user_id, SUM(msg_day) AS total_xp FROM app_public.user_levels WHERE last_msg >= date_trunc('day', now()) AND last_msg < date_trunc('day', now()) + interval '1 day' GROUP BY user_id) filtered JOIN (SELECT user_id, SUM(msg_all_time) AS all_time_xp FROM app_public.user_levels GROUP BY user_id) all_time ON filtered.user_id = all_time.user_id);
CREATE MATERIALIZED VIEW "app_public"."global_user_level_rankings_month" AS (SELECT filtered.user_id, filtered.total_xp, all_time.all_time_xp, DENSE_RANK() OVER (ORDER BY filtered.total_xp DESC, filtered.user_id DESC) AS rank FROM (SELECT user_id, SUM(msg_month) AS total_xp FROM app_public.user_levels WHERE last_msg >= date_trunc('month', now()) AND last_msg < date_trunc('month', now()) + interval '1 month' GROUP BY user_id) filtered JOIN (SELECT user_id, SUM(msg_all_time) AS all_time_xp FROM app_public.user_levels GROUP BY user_id) all_time ON filtered.user_id = all_time.user_id);
CREATE MATERIALIZED VIEW "app_public"."global_user_level_rankings_week" AS (SELECT filtered.user_id, filtered.total_xp, all_time.all_time_xp, DENSE_RANK() OVER (ORDER BY filtered.total_xp DESC, filtered.user_id DESC) AS rank FROM (SELECT user_id, SUM(msg_week) AS total_xp FROM app_public.user_levels WHERE last_msg >= date_trunc('week', now()) AND last_msg < date_trunc('week', now()) + interval '1 week' GROUP BY user_id) filtered JOIN (SELECT user_id, SUM(msg_all_time) AS all_time_xp FROM app_public.user_levels GROUP BY user_id) all_time ON filtered.user_id = all_time.user_id);

-- Indexes on materialized views (drizzle-kit does not generate these — appended manually per design decision 3)
CREATE UNIQUE INDEX ON app_public.global_user_level_rankings_all_time (user_id);
CREATE INDEX ON app_public.global_user_level_rankings_all_time (rank);
CREATE UNIQUE INDEX ON app_public.global_user_level_rankings_day (user_id);
CREATE INDEX ON app_public.global_user_level_rankings_day (rank);
CREATE UNIQUE INDEX ON app_public.global_user_level_rankings_week (user_id);
CREATE INDEX ON app_public.global_user_level_rankings_week (rank);
CREATE UNIQUE INDEX ON app_public.global_user_level_rankings_month (user_id);
CREATE INDEX ON app_public.global_user_level_rankings_month (rank);
