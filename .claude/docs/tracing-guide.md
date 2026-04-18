# Tracing Best Practices

Opinionated guide for adding OpenTelemetry tracing to sushii-worker features. The goal is signal-dense traces with zero noise — every span should be something you'd want to click on in SigNoz when debugging a real incident.

## What to Trace

### Trace these

| Category | Why |
|---|---|
| **Feature entry points** — top-level handler for a command, interaction, or event | Root spans; lets you find all work triggered by one user action |
| **External HTTP calls** — Discord REST, Google Calendar, any third-party API | Latency attribution; required for SigNoz External API view |
| **Interaction lifecycle** — modal await, modal submit, button handler | Measures user wait time + surfaces form validation failures |
| **Stateful operations** — poll cycles, background jobs, scheduled work | Root cause of async failures; shows cadence drift |
| **Branching decisions with observable outcomes** — full vs incremental sync, cache hit vs miss | Use span attributes, not separate spans |

### Do not trace these

| Category | Why not |
|---|---|
| **Pure computation** — rendering, sorting, filtering, mapping | No I/O; latency is negligible; just adds noise |
| **Repository/DB methods directly** — unless a query is unexpectedly slow | Drizzle calls are already fast; instrument the service layer instead |
| **Loops over individual items** — per-event processing inside a sync | Creates thousands of spans; use a counter attribute on the parent span instead |
| **No-op branches** — paths that return early with no side effects | Adds spans to the waterfall that obscure the real work |
| **Helper/utility functions** — unless they call I/O | Keep spans at the service boundary, not inside private methods |

---

## Span Naming

Pattern: `feature.component.operation`

```ts
// Good
"schedule.poll.schedule"
"schedule.discord.sync_messages"
"schedule.config.modal_submit"
"automod.alert.handle"

// Bad — too generic
"poll"
"sync"
"handle"

// Bad — too granular
"schedule.discord.sync_messages.build_month_index"
"schedule.discord.sync_messages.diff_events"
```

For external HTTP calls, follow OTel semantic convention format: `METHOD hostname`

```ts
`GET googleapis.com calendar events`
`POST discord.com interaction callback`
```

---

## Span Kinds

| Kind | When to use |
|---|---|
| `SpanKind.INTERNAL` (default) | All in-process business logic |
| `SpanKind.CLIENT` | Any outbound HTTP call — Discord REST, Google Calendar, etc. |
| `SpanKind.CONSUMER` | Background job consumers, queue processors |

---

## Standard Span Structure

Always use the try/catch/finally pattern so spans always close:

```ts
const tracer = opentelemetry.trace.getTracer("feature-name");

await tracer.startActiveSpan(
  "feature.component.operation",
  {
    attributes: {
      // Set known-at-call-time attributes here
      "guild.id": guildId,
      "user.id": userId,
    },
  },
  async (span) => {
    try {
      // Work...

      // Add computed attributes when available
      span.setAttribute("result.count", items.length);

      // Emit events at meaningful milestones
      span.addEvent("items_processed", { "items.count": items.length });

      return result;
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      span.setStatus({ code: SpanStatusCode.ERROR, message: "brief description" });
      throw err; // always rethrow
    } finally {
      span.end(); // always end in finally
    }
  },
);
```

---

## Attributes

### Always set on every span

```ts
"guild.id"      // string — the guild this operation is for
"user.id"       // string — Discord user ID if user-initiated
"channel.id"    // string — if the span is channel-scoped
```

### Set when available (not always required)

```ts
"discord.interaction.id"   // For interaction-triggered spans
"calendar.id"              // For Google Calendar operations
```

### Standard attribute shapes

Use **OTel semantic conventions** for HTTP/network attributes:

```ts
// HTTP client spans (external calls)
"http.request.method"       // "GET", "POST", etc.
"http.response.status_code" // integer
"http.route"                // normalized path template, e.g. /v3/calendars/{id}/events
"url.full"                  // full URL (redact secrets — see Security section)
"server.address"            // "discord.com", "googleapis.com"
```

Use **dot-namespaced custom attributes** for domain concepts:

```ts
// Format: noun.adjective or noun.property
"schedule.fetch_type"        // "full" | "incremental"
"calendar.sync_type"         // "full" | "incremental"
"calendar.pages_fetched"     // integer
"calendar.items_fetched"     // integer
"messages.edited"            // integer
"messages.deleted"           // integer
```

### Attribute types

- IDs (guild, channel, user, message): always **string**, even if numeric snowflakes
- Counts: **integer**
- Enum values: **string** ("full", "incremental", "success", "error")
- Booleans: only for true binary flags with no third state

---

## Span Events

Use `span.addEvent()` for **milestones within a span** — points in time that matter for debugging.

```ts
// Good uses of events
span.addEvent("sync_token_expired");
span.addEvent("calendar_fetched", { "calendar.changed_items": items.length });
span.addEvent("discord_sync_complete");
span.addEvent("deferUpdate");    // After acknowledging an interaction
span.addEvent("editReply");      // After sending the final response

// Bad — these should be span attributes, not events
span.addEvent("fetch_type_set", { type: "full" });  // Just use span.setAttribute()
span.addEvent("started");                            // Redundant — spans have start times
span.addEvent("ended");                              // Redundant — spans have end times
```

**Rule:** If it has no timestamp significance (i.e., you care *what* not *when*), use an attribute. If timing matters, use an event.

---

## Error Handling

Record the exception **and** set the status. Both are needed — `recordException` attaches the stack trace, `setStatus` marks the span red in SigNoz.

```ts
catch (err) {
  span.recordException(err instanceof Error ? err : new Error(String(err)));
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: "brief description of what failed",
  });
  throw err; // always rethrow — don't swallow errors in span catch blocks
}
```

For **known/expected errors** (e.g., user dismissed modal, 404 not found), use an event instead of marking the span as error:

```ts
// User dismissed — not a system error, don't pollute error rate
span.addEvent("modal_dismissed");
// No setStatus(ERROR) here

// vs. unexpected 403 from Google Calendar — this IS an error
span.addEvent("calendar_access_error", { "http.response.status_code": 403 });
span.setStatus({ code: SpanStatusCode.ERROR, message: "Calendar access denied" });
```

---

## Interaction & Modal Tracing

Discord interactions have two distinct phases that should be separate spans:

### Pattern: modal await + modal submit

```ts
// Span 1: How long did the user take to fill the form?
const submit = await tracer.startActiveSpan(
  "feature.config.modal_await",
  async (awaitSpan) => {
    try {
      return await interaction.awaitModalSubmit({
        time: MODAL_AWAIT_TIMEOUT_MS,
        filter: (i) => i.user.id === interaction.user.id && i.customId === modalCustomId,
      });
    } catch {
      // User dismissed or timed out — not an error
      return null;
    } finally {
      awaitSpan.end();
    }
  },
);

if (!submit) {
  return; // Modal dismissed
}

// Span 2: Process the submission
await tracer.startActiveSpan(
  "feature.config.modal_submit",
  async (submitSpan) => {
    submitSpan.setAttributes({
      "discord.interaction.id": submit.id,
      "user.id": submit.user.id,
      "guild.id": guildId,
    });

    try {
      await submit.deferUpdate();
      submitSpan.addEvent("deferUpdate");

      // ... process form data ...

      await submit.editReply(/* ... */);
      submitSpan.addEvent("editReply");
    } catch (err) {
      submitSpan.recordException(err instanceof Error ? err : new Error(String(err)));
      submitSpan.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      submitSpan.end();
    }
  },
);
```

### Why two spans?

- `modal_await` duration = **user think time** (can be 0–60s); separating it prevents it from dominating the processing time
- `modal_submit` duration = **bot processing time**; this is what you care about for latency SLOs

### Button handlers

Button handlers that open a modal: single span covering the button click → modal shown.
```ts
await tracer.startActiveSpan(
  "feature.config.new_button",
  async (span) => {
    span.setAttributes({
      "discord.interaction.id": interaction.id,
      "user.id": interaction.user.id,
      "guild.id": guildId,
    });
    try {
      await interaction.showModal(/* ... */);
      span.addEvent("modalShown");
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  },
);
```

---

## Avoiding Noise

### Skip no-op paths

Don't emit events or add attributes when nothing happened:

```ts
// Only emit if there was actual work
if (edited + posted + reposted + deleted > 0) {
  span.addEvent("messages_synced", {
    "messages.edited": edited,
    "messages.posted": posted,
    "messages.reposted": reposted,
    "messages.deleted": deleted,
    "messages.unchanged": unchanged,
  });
}
```

### Aggregate loops with attributes, not child spans

```ts
// Bad — creates N spans for N items
for (const event of events) {
  await tracer.startActiveSpan("process_event", async (span) => {
    await processEvent(event);
    span.end();
  });
}

// Good — one parent span, count as attribute
await tracer.startActiveSpan("process_events", async (span) => {
  let processed = 0;
  for (const event of events) {
    await processEvent(event);
    processed++;
  }
  span.setAttribute("events.processed", processed);
  span.end();
});
```

### Don't span pure-computation helpers

```ts
// Bad — no I/O, no value
tracer.startActiveSpan("render_schedule_month", async (span) => {
  const result = renderMonth(events); // pure function
  span.end();
  return result;
});

// Good — just call it
const result = renderMonth(events);
```

---

## Security

### Redact secrets from URLs

Never put raw API keys, tokens, or credentials in `url.full` or any attribute:

```ts
function redactUrl(url: URL): string {
  const copy = new URL(url.toString());
  if (copy.searchParams.has("key")) {
    copy.searchParams.set("key", "REDACTED");
  }
  return copy.toString();
}

span.setAttribute("url.full", redactUrl(url));
```

### Normalize Discord paths

Snowflakes and tokens in Discord URLs cause cardinality explosion. Use the shared normalizer from `discordRestTracing.ts` — it's already wired to all Discord REST calls automatically.

For any manual Discord URL construction, normalize before setting as attribute:
- Snowflake IDs (`\d{17,21}`) → `{id}`
- Long base64url tokens (80+ chars) → `{token}`

---

## Metrics vs Traces

Traces are not metrics. Use the right tool:

| Need | Use |
|---|---|
| "How often does X happen?" | Counter metric with outcome label |
| "What's the 95th percentile latency?" | Histogram metric |
| "Why did this specific request fail?" | Trace + span events |
| "Which step in this flow took longest?" | Child spans |
| "Did this request succeed?" | `span.setStatus()` |

Counters with outcome labels complement traces for alerting:

```ts
// Counter tracks rate — trace captures detail
pollCounter.add(1, { outcome: "success" });
pollCounter.add(1, { outcome: "transient_error" });
pollCounter.add(1, { outcome: "permanent_403" });
```

See `ScheduleMetrics.ts` for the reference implementation.

---

## Tracer Initialization

One tracer per feature, created at module scope:

```ts
import opentelemetry from "@opentelemetry/api";

const tracer = opentelemetry.trace.getTracer("feature-name");
```

Use the feature name as the tracer name (e.g., `"schedule"`, `"automod"`, `"moderation"`). This shows up as the instrumentation scope in SigNoz.
