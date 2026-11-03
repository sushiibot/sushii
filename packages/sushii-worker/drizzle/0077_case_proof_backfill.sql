-- mod_logs.action_time is a UTC timestamp without time zone.
-- Multi-dimensional arrays can't be unnested into one list, so they're skipped.
INSERT INTO "app_public"."mod_log_proofs" ("guild_id", "case_id", "author_id", "created_at", "attachments", "source")
SELECT
	"m"."guild_id",
	"m"."case_id",
	"m"."executor_id",
	"m"."action_time" AT TIME ZONE 'UTC',
	"f"."urls",
	'backfill'
FROM "app_public"."mod_logs" AS "m"
CROSS JOIN LATERAL (
	SELECT array_agg("u"."a" ORDER BY "u"."ord") AS "urls"
	FROM unnest("m"."attachments") WITH ORDINALITY AS "u"("a", "ord")
	WHERE btrim("u"."a") <> ''
) AS "f"
WHERE array_ndims("m"."attachments") = 1
	AND "f"."urls" IS NOT NULL;
