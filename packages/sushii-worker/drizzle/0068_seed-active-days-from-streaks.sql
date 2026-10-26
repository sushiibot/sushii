-- A streak of N days ending on the last use means the last min(N, 30) days were active
UPDATE "app_public"."users"
SET
  "fishy_days_anchor" = floor(extract(epoch FROM "last_fishies") / 86400)::integer,
  "fishy_days_mask" = (1 << least(greatest("fishy_streak", 1), 30)) - 1,
  "fishy_days_total" = greatest("fishy_streak", 1)
WHERE "last_fishies" IS NOT NULL;
--> statement-breakpoint
UPDATE "app_public"."users"
SET
  "rep_days_anchor" = floor(extract(epoch FROM "last_rep") / 86400)::integer,
  "rep_days_mask" = (1 << least(greatest("rep_streak", 1), 30)) - 1
WHERE "last_rep" IS NOT NULL;
