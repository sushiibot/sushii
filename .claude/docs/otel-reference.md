# OpenTelemetry Reference

Canonical setup for sushii-* services running on Bun (non-Sentry). Copy from `.claude/templates/otel/` — only change the tracer name in `tracing.ts`.

> **sushii-worker** is different: uses `BasicTracerProvider` + Sentry integration (`SentrySampler`, `SentrySpanProcessor`, `SentryContextManager`, `SentryPropagator`). See `packages/sushii-worker/src/shared/infrastructure/opentelemetry/otel.ts`.

## Why not NodeSDK / NodeTracerProvider?

`NodeTracerProvider` and `NodeSDK` rely on `async_hooks` and `import-in-the-middle` for context propagation and auto-instrumentation. Both silently fail in Bun — spans are created as `NonRecordingSpan` no-ops that never export.

Tracked in: https://github.com/oven-sh/bun/issues/3775

Key findings from that issue:
- `--preload` solves initialization ordering but does **not** fix `async_hooks` context propagation
- Auto-instrumentation (http, pg, etc.) does not work — module patching is broken in Bun's ESM
- `BasicTracerProvider` + HTTP exporters work correctly
- `AsyncLocalStorage` **is** supported by Bun, so `AsyncLocalStorageContextManager` works
- `@opentelemetry/instrumentation-undici` works because it uses `diagnostics_channel` only (no module patching) — but only captures true undici calls. Discord.js in Bun uses the **global `fetch`** (web entry point), not undici directly, so Discord REST calls are **not** captured automatically (see Discord REST section below)

A native `bun-otel` package is in progress (PR #24063) but not merged as of 2026-04.

## Pino log-trace correlation

Add a mixin to the pino logger to inject trace context into every log record:

```ts
import { trace } from "@opentelemetry/api";
import pino from "pino";

const logger = pino({
  // ...
  mixin() {
    const span = trace.getActiveSpan();
    if (!span) return {};
    const { traceId, spanId, traceFlags } = span.spanContext();
    if (!traceId) return {};
    return { trace_id: traceId, span_id: spanId, trace_flags: traceFlags };
  },
});
```

**Do not use `@opentelemetry/instrumentation-pino`** — it relies on module patching which silently fails in Bun (same root cause as NodeSDK). The manual mixin uses the OTel API directly and works correctly.

The otel-collector-agent is already configured to parse JSON log bodies and promote `trace_id`/`span_id` to OTel log record fields — no per-service changes needed. See `sushii-ansible/services/monitoring/otel-collector-agent/otel-collector-agent-config.yaml`.

## Bun fetch() tracing

`UndiciInstrumentation` only captures undici HTTP calls. Bun's native `fetch()` is **not** undici and is not captured automatically. Wrap `fetch()` manually with a `SpanKind.CLIENT` span using these attributes for SigNoz external API monitoring:

```ts
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";

tracer.startActiveSpan("GET api.example.com", {
  kind: SpanKind.CLIENT,
  attributes: {
    "http.request.method": method,
    "url.full": req.url,
    "server.address": hostname,
  },
}, async (span) => {
  const res = await fetch(req);
  span.setAttribute("http.response.status_code", res.status);
  // ...
  span.end();
});
```

`server.address` and `url.full` are required for SigNoz's External API monitoring view to detect and group calls by domain.

## Discord REST tracing (sushii-worker)

Discord.js in Bun uses global `fetch` (not undici), so `UndiciInstrumentation` — although still registered — misses all Discord API calls. Instead, hook into `@discordjs/rest`'s `makeRequest` option.

**Key points:**
- Extract `MakeRequestInit` from `RESTOptions["makeRequest"]` to avoid undici version conflicts
- Normalize path segments: snowflakes (`\d{17,21}`) → `{id}`, long base64url strings (80+ chars) → `{token}`
- Query params are excluded (only `pathname` is used)
- Set `url.full` to `https://discord.com${normalizedPath}` — SigNoz External API monitoring requires `url.full` to detect and group calls by domain; using the normalized path prevents token leakage
- Use `http.route` for the normalized path (OTel semantic conventions)

See `packages/sushii-worker/src/shared/infrastructure/opentelemetry/discordRestTracing.ts` for the full implementation.

Wire it up in the Discord client constructor:

```ts
import { makeTracedDiscordRequest } from "@/shared/infrastructure/opentelemetry/discordRestTracing";

new Client({
  rest: {
    makeRequest: makeTracedDiscordRequest,
  },
});
```

## Services using this pattern

| Service | Status |
|---|---|
| sushii-modmail | canonical source (updated 2026-04) |
| sushii-leveling-bot | updated 2026-04 |
| sushii-sns | updated 2026-04 (includes pino mixin + tracedFetch) |

When you improve the template, update this table and backport to the listed services.

## Entrypoint wiring

Call `setupOtel()` **before** any other imports that use the OTel API:

```ts
import { setupOtel } from "./instrumentation";

const otel = setupOtel();

process.on("SIGTERM", async () => {
  await otel.shutdown();
  process.exit(0);
});
```

## Required packages

```
@opentelemetry/api
@opentelemetry/context-async-hooks
@opentelemetry/exporter-metrics-otlp-http
@opentelemetry/exporter-trace-otlp-http
@opentelemetry/instrumentation
@opentelemetry/instrumentation-undici
@opentelemetry/resources
@opentelemetry/sdk-metrics
@opentelemetry/sdk-trace-base
@opentelemetry/semantic-conventions
```

**Removed vs old template:**
- `@opentelemetry/exporter-metrics-otlp-grpc` → replaced by `-http` variant
- `@opentelemetry/exporter-trace-otlp-grpc` → replaced by `-http` variant
- `@opentelemetry/sdk-trace-node` → replaced by `sdk-trace-base` + `context-async-hooks`

## Env vars

| Variable | Default | Notes |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | HTTP port (was 4317 for gRPC) |
| `OTEL_SERVICE_NAME` | — | Required |
| `OTEL_RESOURCE_ATTRIBUTES` | — | e.g. `deployment.environment=production` |
| `OTEL_EXPORTER_OTLP_HEADERS` | — | e.g. `Authorization=Bearer ...` |
| `OTEL_TRACES_SAMPLER` | `parentbased_always_on` | |
| `GIT_HASH` | `unknown` | Mapped to `service.version` |
| `OTEL_METRIC_EXPORT_INTERVAL` | `60000` | ms; not auto-read by `PeriodicExportingMetricReader` |
