-- Custom SQL migration file, put your code below! ---- No reader grant: analytics views read this one, sushii-mcp only sees those.
CREATE VIEW "app_public"."product_event_parts" AS
WITH periods (period, since, until) AS (
  VALUES
    (
      'today',
      date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
      'infinity'::timestamptz
    ),
    (
      'week',
      date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
      'infinity'::timestamptz
    ),
    (
      'closed',
      (date_trunc('week', now() AT TIME ZONE 'UTC') - interval '7 days') AT TIME ZONE 'UTC',
      date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    )
)
SELECT
  p.period,
  e.feature,
  e.guild_id,
  e.actor,
  CASE e.name
    WHEN 'feedback.submitted' THEN e.props ->> 'kind'
    WHEN 'proof.added' THEN e.props ->> 'source'
    WHEN 'update.relayed' THEN e.props ->> 'outcome'
    WHEN 'prompt.shown' THEN e.props ->> 'prompt'
    WHEN 'prompt.action' THEN e.props ->> 'prompt'
    ELSE e.props ->> 'route'
  END AS part,
  CASE e.name
    WHEN 'interaction.command' THEN 'command'
    WHEN 'interaction.context_menu' THEN 'context menu'
    WHEN 'interaction.button' THEN 'button'
    WHEN 'interaction.select' THEN 'select'
    WHEN 'interaction.modal' THEN 'modal'
    WHEN 'feedback.submitted' THEN 'feedback'
    WHEN 'proof.added' THEN 'proof'
    WHEN 'update.relayed' THEN 'update'
    ELSE 'prompt'
  END AS kind,
  coalesce(
    e.props ->> 'audience',
    CASE e.name
      WHEN 'proof.added' THEN 'staff'
      WHEN 'prompt.shown' THEN 'staff'
      WHEN 'prompt.action' THEN 'staff'
      WHEN 'feedback.submitted' THEN 'member'
      WHEN 'update.relayed' THEN 'bot'
      ELSE 'unknown'
    END
  ) AS audience,
  e.props ->> 'status' = 'error' AS failed
FROM "app_public"."product_events" e
JOIN periods p ON e.occurred_at >= p.since AND e.occurred_at < p.until;
--> statement-breakpoint
CREATE VIEW "analytics"."feature_parts" AS
WITH counts AS (
  SELECT
    period,
    feature,
    part,
    kind,
    audience,
    count(*)::int AS events,
    count(*) FILTER (WHERE failed)::int AS errors,
    count(DISTINCT actor)::int AS users,
    count(DISTINCT guild_id)::int AS servers
  FROM "app_public"."product_event_parts"
  WHERE part IS NOT NULL
  GROUP BY 1, 2, 3, 4, 5
)
SELECT
  period,
  feature,
  part,
  kind,
  audience,
  events,
  errors,
  CASE WHEN users >= 5 THEN users END AS users,
  CASE WHEN servers >= 5 THEN servers END AS servers
FROM counts
WHERE greatest(users, servers) >= 5;
--> statement-breakpoint
CREATE VIEW "analytics"."feature_audience" AS
WITH reported AS (
  SELECT period, feature
  FROM "app_public"."product_event_parts"
  GROUP BY 1, 2
  HAVING greatest(count(DISTINCT actor), count(DISTINCT guild_id)) >= 5
),
counts AS (
  SELECT
    period,
    feature,
    audience,
    count(*)::int AS events,
    count(DISTINCT actor)::int AS users,
    count(DISTINCT guild_id)::int AS servers
  FROM "app_public"."product_event_parts"
  GROUP BY 1, 2, 3
)
SELECT
  c.period,
  c.feature,
  c.audience,
  c.events,
  CASE WHEN c.users >= 5 THEN c.users END AS users,
  CASE WHEN c.servers >= 5 THEN c.servers END AS servers
FROM counts c
JOIN reported r USING (period, feature);
--> statement-breakpoint
-- Follows each person from their first showing, so a click in a later week still counts.
CREATE VIEW "analytics"."prompt_outcomes" AS
WITH shown AS (
  SELECT props ->> 'prompt' AS prompt, actor, min(occurred_at) AS first_shown
  FROM "app_public"."product_events"
  WHERE name = 'prompt.shown'
    AND actor IS NOT NULL
    AND occurred_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') - interval '29 days') AT TIME ZONE 'UTC'
  GROUP BY 1, 2
),
outcomes AS (
  SELECT
    s.prompt,
    CASE
      WHEN a.action = 'completed' OR proof.added THEN 'completed'
      WHEN a.action = 'snooze' THEN 'snoozed'
      WHEN a.action = 'dismiss' THEN 'dismissed'
      WHEN a.action IS NOT NULL THEN 'started'
      ELSE 'no_response'
    END AS outcome
  FROM shown s
  LEFT JOIN LATERAL (
    SELECT e.props ->> 'action' AS action
    FROM "app_public"."product_events" e
    WHERE e.name = 'prompt.action'
      AND e.actor = s.actor
      AND e.props ->> 'prompt' = s.prompt
      AND e.occurred_at >= s.first_shown
    ORDER BY e.props ->> 'action' = 'completed' DESC, e.occurred_at DESC
    LIMIT 1
  ) a ON true
  CROSS JOIN LATERAL (
    SELECT s.prompt = 'proof_intro' AND EXISTS (
      SELECT 1
      FROM "app_public"."product_events" e
      WHERE e.name = 'proof.added'
        AND e.actor = s.actor
        AND e.props ->> 'outcome' IN ('ok', 'partial')
        AND e.occurred_at >= s.first_shown
        AND e.occurred_at < s.first_shown + interval '7 days'
    ) AS added
  ) proof
),
counts AS (
  SELECT prompt, outcome, count(*)::int AS people
  FROM outcomes
  GROUP BY 1, 2
),
totals AS (
  SELECT prompt, sum(people)::int AS shown
  FROM counts
  GROUP BY 1
)
SELECT
  c.prompt,
  c.outcome,
  CASE WHEN c.people >= 5 THEN c.people END AS people,
  t.shown
FROM counts c
JOIN totals t USING (prompt)
WHERE t.shown >= 5;
--> statement-breakpoint
GRANT SELECT ON "analytics"."feature_parts", "analytics"."feature_audience", "analytics"."prompt_outcomes" TO "sushii_mcp_reader";
