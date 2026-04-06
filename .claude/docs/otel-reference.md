# OpenTelemetry Reference

Canonical setup for sushii-* services running on Bun (non-Sentry). Copy from `.claude/templates/otel/` — only change the tracer name in `tracing.ts`.

> **sushii-worker** is different: uses `NodeSDK` + Sentry integration. See `packages/sushii-worker/src/shared/infrastructure/opentelemetry/otel.ts`.

## Why not NodeSDK / NodeTracerProvider?

`NodeTracerProvider` and `NodeSDK` rely on `async_hooks` and `import-in-the-middle` for context propagation and auto-instrumentation. Both silently fail in Bun — spans are created as `NonRecordingSpan` no-ops that never export.

Tracked in: https://github.com/oven-sh/bun/issues/3775

Key findings from that issue:
- `--preload` solves initialization ordering but does **not** fix `async_hooks` context propagation
- Auto-instrumentation (http, pg, etc.) does not work — module patching is broken in Bun's ESM
- `BasicTracerProvider` + HTTP exporters work correctly
- `AsyncLocalStorage` **is** supported by Bun, so `AsyncLocalStorageContextManager` works
- `@opentelemetry/instrumentation-undici` works because it uses `diagnostics_channel` only (no module patching) — this gives automatic tracing for all undici HTTP calls including discord.js

A native `bun-otel` package is in progress (PR #24063) but not merged as of 2026-04.

## Services using this pattern

| Service | Status |
|---|---|
| sushii-modmail | canonical source (updated 2026-04) |
| sushii-leveling-bot | updated 2026-04 |

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
