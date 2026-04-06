import { context, metrics, propagation, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import {
  detectResources,
  envDetector,
  resourceFromAttributes,
} from "@opentelemetry/resources";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import * as Sentry from "@sentry/bun";
import {
  SentryContextManager,
  validateOpenTelemetrySetup,
} from "@sentry/node-core";
import {
  SentryPropagator,
  SentrySampler,
  SentrySpanProcessor,
} from "@sentry/opentelemetry";
import type { Logger } from "pino";

import { config } from "@/shared/infrastructure/config";

// Standard OTel env vars (read via envDetector):
//   OTEL_EXPORTER_OTLP_ENDPOINT     — HTTP collector (default: http://localhost:4318)
//   OTEL_EXPORTER_OTLP_HEADERS      — auth headers (key=value,key2=value2)
//   OTEL_SERVICE_NAME               — overrides default "sushii_bot"
//   OTEL_RESOURCE_ATTRIBUTES        — e.g. deployment.environment=production
//
// Custom env vars (read manually):
//   GIT_HASH                        — mapped to service.version
//   OTEL_METRIC_EXPORT_INTERVAL     — metric flush interval in ms (default 60000)

export function initializeOtel(logger: Logger, clusterId: number) {
  const sentryClient = Sentry.init({
    dsn: config.sentry.dsn,
    environment: config.sentry.environment,
    release: config.build.gitHash,
    skipOpenTelemetrySetup: true,

  });

  // envDetector reads OTEL_SERVICE_NAME and OTEL_RESOURCE_ATTRIBUTES.
  // BasicTracerProvider doesn't auto-read env vars like NodeSDK — use envDetector explicitly.
  // OTEL_SERVICE_NAME must be set in the environment — not hardcoded here since multiple services share this file.
  // merge(other): other's attributes win, so envDetector result overrides the fallback attributes below.
  const fallbackAttributes: Record<string, string> = {
    "cluster.id": clusterId,
  };
  if (config.build.gitHash) {
    fallbackAttributes[ATTR_SERVICE_VERSION] = config.build.gitHash;
  }
  const resource = resourceFromAttributes(fallbackAttributes).merge(
    detectResources({ detectors: [envDetector] }),
  );

  // ---------------------------------------------------------------------------
  // Traces — BasicTracerProvider works in Bun; NodeSDK/NodeTracerProvider don't
  // (they use import-in-the-middle / async_hooks which fail silently in Bun)
  // ---------------------------------------------------------------------------
  const traceExporter = new OTLPTraceExporter();
  const tracerProvider = new BasicTracerProvider({
    resource,
    sampler: sentryClient ? new SentrySampler(sentryClient) : undefined,
    spanProcessors: [
      new SentrySpanProcessor(),
      new BatchSpanProcessor(traceExporter),
    ],
  });

  trace.setGlobalTracerProvider(tracerProvider);
  propagation.setGlobalPropagator(new SentryPropagator());

  // AsyncLocalStorage is supported by Bun — required for parent-child span tracking.
  // SentryContextManager wraps it for Sentry context propagation.
  const contextManager = new SentryContextManager();
  contextManager.enable();
  context.setGlobalContextManager(contextManager);

  // UndiciInstrumentation uses diagnostics_channel (no module patching) — works in Bun.
  // Note: PinoInstrumentation uses require-in-the-middle and is NOT compatible with Bun.
  registerInstrumentations({
    instrumentations: [new UndiciInstrumentation()],
  });

  validateOpenTelemetrySetup();

  // ---------------------------------------------------------------------------
  // Metrics
  // ---------------------------------------------------------------------------
  const parsed = parseInt(process.env.OTEL_METRIC_EXPORT_INTERVAL ?? "", 10);
  const exportIntervalMillis = Number.isNaN(parsed) ? 60_000 : parsed;

  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis,
        exportTimeoutMillis: 5_000,
      }),
    ],
  });
  metrics.setGlobalMeterProvider(meterProvider);

  logger.info(
    {
      endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
      exportIntervalMillis,
    },
    "opentelemetry initialized",
  );

  const shutdown = async () => {
    await Promise.all([tracerProvider.shutdown(), meterProvider.shutdown()]);
  };

  return { tracerProvider, meterProvider, shutdown };
}
