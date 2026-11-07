-- Reads raw events so today and the open week show up before the weekly rollup. Small groups stay hidden.
CREATE VIEW "analytics"."usage_daily" AS
WITH counts AS (
  SELECT
    (occurred_at AT TIME ZONE 'UTC')::date AS day,
    feature,
    count(DISTINCT guild_id)::int AS guilds,
    count(DISTINCT actor)::int AS actors,
    count(*)::int AS events
  FROM "app_public"."product_events"
  WHERE occurred_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') - interval '29 days') AT TIME ZONE 'UTC'
  GROUP BY 1, 2
  UNION ALL
  SELECT
    (occurred_at AT TIME ZONE 'UTC')::date,
    'all',
    count(DISTINCT guild_id)::int,
    count(DISTINCT actor)::int,
    count(*)::int
  FROM "app_public"."product_events"
  WHERE occurred_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') - interval '29 days') AT TIME ZONE 'UTC'
    AND feature <> 'unmatched'
  GROUP BY 1
)
SELECT
  day,
  feature,
  CASE WHEN guilds >= 5 THEN guilds END AS guilds,
  CASE WHEN actors >= 5 THEN actors END AS actors,
  events
FROM counts
WHERE feature = 'all' OR greatest(guilds, actors) >= 5;
--> statement-breakpoint
CREATE VIEW "analytics"."usage_current_week" AS
WITH counts AS (
  SELECT
    feature,
    count(DISTINCT guild_id)::int AS guilds,
    count(DISTINCT actor)::int AS actors,
    count(*)::int AS events
  FROM "app_public"."product_events"
  WHERE occurred_at >= date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
  GROUP BY 1
  UNION ALL
  SELECT
    'all',
    count(DISTINCT guild_id)::int,
    count(DISTINCT actor)::int,
    count(*)::int
  FROM "app_public"."product_events"
  WHERE occurred_at >= date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    AND feature <> 'unmatched'
)
SELECT
  date_trunc('week', now() AT TIME ZONE 'UTC')::date AS week,
  feature,
  CASE WHEN guilds >= 5 THEN guilds END AS guilds,
  CASE WHEN actors >= 5 THEN actors END AS actors,
  events
FROM counts
WHERE feature = 'all' OR greatest(guilds, actors) >= 5;
--> statement-breakpoint
GRANT SELECT ON "analytics"."usage_daily", "analytics"."usage_current_week" TO "sushii_mcp_reader";
