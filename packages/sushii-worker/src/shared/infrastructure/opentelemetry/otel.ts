import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import {
  detectResources,
  envDetector,
  resourceFromAttributes,
} from "@opentelemetry/resources";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  ATTR_SERVICE_NAME,
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

    tracesSampleRate: 0.005,
  });

  // envDetector reads OTEL_SERVICE_NAME and OTEL_RESOURCE_ATTRIBUTES.
  // Merging with defaults: envDetector values win over the fallback attributes.
  const resource = detectResources({ detectors: [envDetector] }).merge(
    resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "sushii_bot",
      [ATTR_SERVICE_VERSION]: config.build.gitHash ?? "unknown",
      "cluster.id": clusterId,
    }),
  );

  const parsed = parseInt(process.env.OTEL_METRIC_EXPORT_INTERVAL ?? "", 10);
  const exportIntervalMillis = Number.isNaN(parsed) ? 60_000 : parsed;

  const sdk = new NodeSDK({
    // Base
    resource,

    // Traces
    sampler: sentryClient ? new SentrySampler(sentryClient) : undefined,
    spanProcessors: [
      // Ensure spans are correctly linked & sent to Sentry
      new SentrySpanProcessor(),
    ],
    // Ensure trace propagation works
    textMapPropagator: new SentryPropagator(),
    // Ensure context & request isolation are correctly managed
    contextManager: new SentryContextManager(),

    // Exporter
    traceExporter: new OTLPTraceExporter(),

    // Instrumentations
    // - PinoInstrumentation: injects trace_id/span_id into pino log records
    // - UndiciInstrumentation: traces undici HTTP calls (including discord.js) via diagnostics_channel
    instrumentations: [
      new PinoInstrumentation(),
      new UndiciInstrumentation(),
    ],

    // Metrics
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis,
      exportTimeoutMillis: 5_000,
    }),
  });

  sdk.start();

  validateOpenTelemetrySetup();

  logger.info(
    {
      endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
      exportIntervalMillis,
    },
    "opentelemetry initialized",
  );

  return sdk;
}
