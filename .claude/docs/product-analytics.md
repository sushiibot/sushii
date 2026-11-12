# Product analytics

How sushii measures feature usage, adoption, funnels and retention. This is separate from Grafana, which is ops
monitoring (rates, errors, latency). Use Grafana metrics to see if something works; use product events to see if
people use it.

## Pieces

| Piece | Where |
|---|---|
| Event model, names, feature map | `packages/sushii-worker/src/features/product-analytics/domain/` (`ProductEvent.ts`, `features.ts`) |
| `track()` (best-effort insert) | `application/ProductAnalyticsService.ts`, wired in `setup.ts` and `core/cluster/initialization/registerFeatures.ts` |
| Automatic interaction events | `core/cluster/discord/InteractionRouter.ts` (`trackInteraction`) |
| Raw table | `app_public.product_events` (90-day retention) |
| Rollups | `product_usage_weekly`, `product_retention_weekly`, `product_rollup_state`; `application/ProductRollupService.ts`, run daily by `infrastructure/tasks/ProductRollupTask.ts` |
| Read-only views | `analytics` schema, created by hand-written custom migrations (`drizzle/0084_analytics-views.sql` and later) |
| API | `packages/sushii-mcp/src/analytics.ts`: `GET /analytics/:view`, allow-listed view names only |
| Dashboard | `packages/sushii-insights` (SvelteKit, tailnet-only), reads the API from server `load` functions |
| User deletion | `packages/sushii-worker/scripts/delete-user-analytics.ts <user id>` |

`track()` is a no-op when `PRODUCT_ANALYTICS_KEY` is unset (local dev, tests).

## Privacy rules (non-negotiable)

Discord only allows API data for improving the app when it's aggregated or de-identified, and sushii's privacy policy
(`docs/content/legal/privacy.md`) promises the same.

- **Never store** user IDs, channel or message IDs, command option values, free text, names, or raw custom IDs
  (they embed IDs). The actor is `actorCode(key, userId)`: an HMAC with a secret key, first 16 bytes.
- **Props are code values only**: closed sets like `surface: "modal"` or `outcome: "ok"`, or bucketed numbers
  (`"1"`, `"2-5"`, `"6+"`). `ProductEventProps` is `Record<string, string>` with no free text by contract.
- **Best-effort**: `track()` never throws and never delays the caller. Don't `await` it, don't wrap it in logic that can
  fail the interaction.
- Raw rows are deleted after 90 days; rollups keep no actor codes or guild IDs. Groups smaller than `SMALL_GROUP_MIN`
  (5, `domain/rollup.ts`) are nulled in rollups.
- A new **category** of data (not just a new event name) needs a privacy policy update that ships before the release.

## What's tracked automatically

Every slash command, context menu, button, select and modal that reaches a registered handler emits
`interaction.command` / `interaction.context_menu` / `interaction.button` / `interaction.select` /
`interaction.modal` with:

- `feature`: from the handler class name via `PRODUCT_FEATURES` in `features.ts` (`unmatched` if not listed)
- `props.route`: the full slash command name, or the handler class name for components
- `props.status`: `success` | `error`
- `props.audience`: `staff` | `member`, from `STAFF_HANDLERS`

Autocomplete is never tracked. Buttons handled by inline collectors (no registered handler) record as `unmatched`.
Interactions only run on the active blue/green slot, so nothing is double-counted.

## Adding analytics to a feature

1. **Register handlers.** Add the feature to `PRODUCT_FEATURES` in `features.ts` with `unit: "guild"` (servers adopt
   it: moderation, settings, role menus) or `unit: "user"` (people come back to it: fishy, levels, reminders), and list
   every handler class. `features.test.ts` fails when a registered handler isn't listed anywhere. Put server-running
   handlers in `STAFF_HANDLERS` and operator-only tools in `INTERNAL_HANDLERS`.
2. **Decide if interaction events are enough.** They answer "how many servers/people used it and how often". Add
   explicit events only for things a click doesn't show: something being offered (exposure), an outcome (saved,
   skipped, undone), or events with no interaction (system posts).
3. **Add event names** to the `ProductEventName` union in `ProductEvent.ts`, named `<area>.<verb>` (`prompt.shown`,
   `proof.added`, `proof_suggestion.undone`). Map each to a feature key in `EVENT_FEATURES` unless every call passes
   `feature`. Bot-initiated events pass `userId: null`. `SYSTEM_EVENT` (`update.relayed`) is the one event that keeps a
   feature row but never makes a server count as active; extend that check if you add another such event.
4. **Emit next to the metric.** Inject the `ProductEventTracker` (`productEvents` from the product-analytics feature
   services) through the feature's setup and call `track({ name, userId, guildId, props })` where the matching OTel
   counter is recorded. A small adapter that records both the metric and the event keeps call sites clean
   (see `proof-suggestions` for an example). Exposure events fire once per thing shown, not per re-render, and they
   count as activity: a server that only saw an offer shows as active. Read adoption from outcome or interaction events.
5. **Test** emission at the adapter or service level with a fake tracker, and that a throwing tracker doesn't change
   the flow.
6. **Need a chart?** Interaction and explicit events already roll up into usage and retention by feature. For a funnel
   or outcome breakdown:
   - add a view in a new custom migration (`bunx drizzle-kit generate --custom --name analytics-<thing>`; the
     `analytics` schema is outside `schemaFilter`, so drizzle won't generate it) ending with an explicit
     `GRANT SELECT ON "analytics"."<view>" TO "sushii_mcp_reader";` as in `0085` and `0086`;
   - add the view name to `ANALYTICS_VIEWS` in `packages/sushii-mcp/src/analytics.ts` (a `sushii-mcp` release; it
     returns empty until the bot migration is live);
   - add the table or chart in `packages/sushii-insights`.
   Views over raw rows only see 90 days; long-term questions need a rollup.

## Don'ts

- Don't add a redirect service or tracking link to measure link-button clicks: it would collect IP addresses. Use a
  normal button that replies with the link, or measure the outcome instead.
- Don't send events to third-party analytics.
- Don't use product events for ops alerting; that's what Grafana metrics and log alerts are for.
- Don't change the meaning of an existing event name or prop value; dashboards and views depend on them. Add a new one.
