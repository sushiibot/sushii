# Cross-Cluster Channel/Guild Access Footgun

## The Problem

`client.channels.fetch(channelId)`, `client.channels.cache.get(channelId)`, and
`client.guilds.cache.get(guildId)` all return `null` / `undefined` when the target guild is
not cached on the calling cluster's shards. With `discord-hybrid-sharding`, guilds are spread
across clusters, so **any code that assumes a specific channel or guild is locally accessible
will silently fail on clusters that don't own those shards.**

This class of bug is easy to miss because:
- It works perfectly in development (single cluster)
- It works on the "right" cluster in production
- Failures are silent (the fetch returns null rather than throwing)

**Common pattern that breaks:**
```ts
// This works on the cluster that owns the guild, silently fails everywhere else
const channel = await client.channels.fetch(SOME_CHANNEL_ID);
if (!channel) {
  logger.error("channel not found"); // but it IS found — just on another cluster
  return;
}
await channel.send(...);
```

## The Fix: DB-Mediated Handoff

When work needs to be *executed* on a specific cluster (the one that owns a particular guild
or channel), decouple **triggering** from **executing** via a database status:

1. **Any cluster** that triggers the work: store all needed data in the DB, set status to a
   "queued" state (e.g. `ready_to_post`).
2. **The owning cluster** runs a background task that polls for the queued rows, uses its local
   cache to send the Discord message/action, and transitions the row to the next state.

The owning cluster is identified by `client.channels.cache.has(channelId)` or
`client.guilds.cache.has(guildId)` — which are reliable after the `ready` event.

## `shouldRunOnCluster` — The Extension Point

`AbstractBackgroundTask` supports an optional `shouldRunOnCluster(client: Client): boolean`
predicate. When defined:
- `registerTasks` registers the task on **every** cluster.
- The cron starts only on clusters where the predicate returns `true`.
- Evaluated after the `ready` event, when `client.channels.cache` and `client.guilds.cache`
  are fully populated.

Tasks without `shouldRunOnCluster` continue to use the existing cluster-0-only behaviour.

```ts
export class MyChannelTask extends AbstractBackgroundTask {
  readonly name = "MyChannelTask";
  readonly cronTime = "*/10 * * * * *";

  shouldRunOnCluster(client: Client): boolean {
    // Only start on the cluster that has this channel in its cache
    return client.channels.cache.has(TARGET_CHANNEL_ID);
  }

  protected async execute(): Promise<void> {
    // Safe to use client.channels.cache.get(TARGET_CHANNEL_ID) here
  }
}
```

**Why evaluate after `ready`?** Discord.js populates the channel and guild caches during the
`GUILD_CREATE` events that arrive before `ready`. Evaluating before `ready` would always see
an empty cache.

## Data to Persist for the Handoff

Any data that is only available on the triggering cluster must be stored in the DB before
the handoff. Common examples:
- **Guild names** — resolved from the triggering cluster's guild cache; the owning cluster
  may not have those guilds cached.
- **File/attachment URLs** — Discord CDN URLs are stable for minutes to hours; store them so
  the owning cluster can re-download.
- **User display names** — resolved from the triggering cluster's user cache.

## Atomic Transition Guard (Blue/Green Safety)

When multiple instances may run simultaneously (e.g. blue/green deploy), guard the
transition with `WHERE status = 'queued_state'` so only one instance wins atomically:

```ts
// Only one instance advances; the rest receive null
const result = await repo.transitionFromQueued(key, { ...newData });
if (!result) {
  // Lost the race — clean up any side effects (e.g. delete Discord message)
  await discordMessage.delete().catch(() => {});
  return;
}
```

## Janitor Coverage

Rows stuck in a queued state (e.g. the owning cluster never came online) should be cleaned up
by the janitor task alongside claimed/in-progress rows. Use the same orphan TTL and extend the
status filter to include all queued states.

## Rollback Notes

DB migration changes (new enum values, new columns) require a two-step rollback:
1. Revert the code (redeploy old version).
2. Roll back the DB migration.

Rows in queued states will persist between steps 1 and 2 — the old code's janitor will not
clean them up. Both steps are required for a clean rollback.
