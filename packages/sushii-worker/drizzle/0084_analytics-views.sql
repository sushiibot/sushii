-- Only these views reach sushii-mcp: the reader role gets no grant on product_events or the tables below.
CREATE SCHEMA "analytics";
--> statement-breakpoint
CREATE VIEW "analytics"."usage_weekly" AS
SELECT week, feature, guilds, actors, events
FROM "app_public"."product_usage_weekly";
--> statement-breakpoint
CREATE VIEW "analytics"."retention_weekly" AS
SELECT cohort_week, unit, feature, weeks_later, base, retained
FROM "app_public"."product_retention_weekly";
--> statement-breakpoint
CREATE VIEW "analytics"."prompt_funnel_weekly" AS
SELECT
  date_trunc('week', occurred_at AT TIME ZONE 'UTC')::date AS week,
  props ->> 'prompt' AS prompt,
  name AS step,
  coalesce(props ->> 'action', 'shown') AS action,
  count(DISTINCT actor)::int AS actors
FROM "app_public"."product_events"
WHERE name IN ('prompt.shown', 'prompt.action')
GROUP BY 1, 2, 3, 4
HAVING count(DISTINCT actor) >= 5;
--> statement-breakpoint
CREATE VIEW "analytics"."update_reach" AS
SELECT
  p.message_id::text AS post_id,
  p.created_at::date AS posted_on,
  d.status,
  count(*)::int AS guilds
FROM "app_public"."sushii_update_posts" p
JOIN "app_public"."sushii_update_deliveries" d ON d.post_id = p.message_id
GROUP BY p.message_id, p.created_at, d.status;
--> statement-breakpoint
CREATE VIEW "analytics"."proof_weekly" AS
SELECT
  date_trunc('week', pr.created_at AT TIME ZONE 'UTC')::date AS week,
  pr.source,
  count(DISTINCT pr.guild_id)::int AS guilds,
  count(*)::int AS proofs,
  percentile_cont(0.5) WITHIN GROUP (
    ORDER BY extract(epoch FROM (pr.created_at AT TIME ZONE 'UTC') - ml.action_time) / 60
  ) AS median_minutes_to_proof
FROM "app_public"."mod_log_proofs" pr
JOIN "app_public"."mod_logs" ml
  ON ml.guild_id = pr.guild_id AND ml.case_id = pr.case_id
WHERE pr.source <> 'backfill'
GROUP BY 1, 2
HAVING count(DISTINCT pr.guild_id) >= 5;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "analytics" TO "sushii_mcp_reader";
--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA "analytics" TO "sushii_mcp_reader";
