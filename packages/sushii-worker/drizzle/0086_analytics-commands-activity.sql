-- update.relayed is the bot posting on its own, so it can't make a server count as active.
CREATE OR REPLACE VIEW "analytics"."usage_daily" AS
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
    AND name <> 'update.relayed'
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
CREATE OR REPLACE VIEW "analytics"."usage_current_week" AS
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
    AND name <> 'update.relayed'
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
CREATE VIEW "analytics"."command_usage" AS
WITH periods (period, since) AS (
  VALUES
    ('today', date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),
    ('week', date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),
    ('30d', (date_trunc('day', now() AT TIME ZONE 'UTC') - interval '29 days') AT TIME ZONE 'UTC')
),
counts AS (
  SELECT
    p.period,
    e.props ->> 'route' AS command,
    count(*)::int AS uses,
    count(DISTINCT e.actor)::int AS users,
    count(DISTINCT e.guild_id)::int AS servers
  FROM "app_public"."product_events" e
  JOIN periods p ON e.occurred_at >= p.since
  WHERE e.name IN ('interaction.command', 'interaction.context_menu')
    AND e.props ->> 'route' IS NOT NULL
  GROUP BY 1, 2
)
SELECT
  period,
  command,
  uses,
  users,
  CASE WHEN servers >= 5 THEN servers END AS servers
FROM counts
WHERE users >= 5;
--> statement-breakpoint
CREATE VIEW "analytics"."server_activity" AS
WITH periods (period, since) AS (
  VALUES
    ('today', date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),
    ('week', date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),
    ('30d', (date_trunc('day', now() AT TIME ZONE 'UTC') - interval '29 days') AT TIME ZONE 'UTC')
),
per_server AS (
  SELECT p.period, e.guild_id, count(*) AS events
  FROM "app_public"."product_events" e
  JOIN periods p ON e.occurred_at >= p.since
  WHERE e.guild_id IS NOT NULL
    AND e.feature <> 'unmatched'
    AND e.name <> 'update.relayed'
  GROUP BY 1, 2
),
levels AS (
  SELECT
    period,
    CASE
      WHEN events >= 100 THEN '100+'
      WHEN events >= 10 THEN '10-99'
      ELSE '1-9'
    END AS level,
    count(*)::int AS servers
  FROM per_server
  GROUP BY 1, 2
)
SELECT period, level, CASE WHEN servers >= 5 THEN servers END AS servers
FROM levels;
--> statement-breakpoint
GRANT SELECT ON "analytics"."command_usage", "analytics"."server_activity" TO "sushii_mcp_reader";
