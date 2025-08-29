import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-grpc";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import {
  defaultResource,
  resourceFromAttributes,
} from "@opentelemetry/resources";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
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

export function initializeOtel(logger: Logger, clusterId: number) {
  const sentryClient = Sentry.init({
    dsn: config.sentry.dsn,
    environment: config.sentry.environment,
    skipOpenTelemetrySetup: true,

    tracesSampleRate: 0.005,
  });

  const resource = defaultResource().merge(
    resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "sushii_bot",
      // No version yet
      // [ATTR_SERVICE_VERSION]: "v1.0.0"
      "cluster.id": clusterId,
    }),
  );

  // Log OTEL configuration for debugging
  logger.info(
    {
      endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    },
    "Initializing OTEL metric exporter",
  );

  const sdk = new NodeSDK({
    // Base
    resource: resource,

    // Traces
    sampler: sentryClient ? new SentrySampler(sentryClient) : undefined,
    spanProcessors: [
      // Ensure spans are correctly linked & sent to Sentry
      new SentrySpanProcessor(),
      // Add additional processors here
    ],
    // Ensure trace propagation works
    // This relies on the SentrySampler for correct propagation
    textMapPropagator: new SentryPropagator(),
    // Ensure context & request isolation are correctly managed
    contextManager: new SentryContextManager(),

    // Exporter
    traceExporter: new OTLPTraceExporter(),

    // Metrics
    instrumentations: [getNodeAutoInstrumentations()],
    metricReader: new PeriodicExportingMetricReader({
      // Configured via env vars, e.g. `OTEL_EXPORTER_OTLP_ENDPOINT`
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: 60_000,
      exportTimeoutMillis: 5_000,
    }),
  });

  // initialize the SDK and register with the OpenTelemetry API
  // this enables the API to record telemetry
  sdk.start();

  validateOpenTelemetrySetup();

  logger.info(
    {
      resource: resource.getRawAttributes(),
    },
    "opentelemetry initialized",
  );

  return sdk;
}
