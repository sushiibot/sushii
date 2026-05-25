-- Migration 0038 dropped and recreated all four global leaderboard materialized views
-- but omitted the unique indexes required for REFRESH MATERIALIZED VIEW CONCURRENTLY.
-- This migration restores them.
CREATE UNIQUE INDEX ON app_public.global_user_level_rankings_all_time (user_id);
CREATE INDEX ON app_public.global_user_level_rankings_all_time (rank);
CREATE UNIQUE INDEX ON app_public.global_user_level_rankings_day (user_id);
CREATE INDEX ON app_public.global_user_level_rankings_day (rank);
CREATE UNIQUE INDEX ON app_public.global_user_level_rankings_week (user_id);
CREATE INDEX ON app_public.global_user_level_rankings_week (rank);
CREATE UNIQUE INDEX ON app_public.global_user_level_rankings_month (user_id);
CREATE INDEX ON app_public.global_user_level_rankings_month (rank);
