-- mod_logs.action_time is a UTC timestamp without time zone.
INSERT INTO "app_public"."mod_log_proofs" ("guild_id", "case_id", "author_id", "created_at", "attachments", "source")
SELECT
	"guild_id",
	"case_id",
	"executor_id",
	"action_time" AT TIME ZONE 'UTC',
	array_remove(array_remove("attachments", ''), NULL),
	'backfill'
FROM "app_public"."mod_logs"
WHERE cardinality(array_remove(array_remove("attachments", ''), NULL)) > 0;
