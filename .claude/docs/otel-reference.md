# OpenTelemetry Reference

Canonical setup for sushii-* services (non-Sentry). Copy from `.claude/templates/otel/` — only change the tracer name in `tracing.ts`.

> **sushii-worker** is different: uses `NodeSDK` + Sentry integration. See `packages/sushii-worker/src/shared/infrastructure/opentelemetry/otel.ts`.

## Services using this pattern

| Service | Status |
|---|---|
| sushii-leveling-bot | canonical source |
| sushii-modmail | minor GIT_HASH drift — update `instrumentation.ts` to match template |

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
@opentelemetry/exporter-metrics-otlp-grpc
@opentelemetry/exporter-trace-otlp-grpc
@opentelemetry/resources
@opentelemetry/sdk-metrics
@opentelemetry/sdk-trace-base
@opentelemetry/sdk-trace-node
@opentelemetry/semantic-conventions
```
