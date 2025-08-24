import type { Span, Tracer } from "@opentelemetry/api";
import { SpanStatusCode } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-grpc";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import {
  defaultResource,
  resourceFromAttributes,
} from "@opentelemetry/resources";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { TraceIdRatioBasedSampler } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import type { Logger } from "pino";

import { config } from "@/shared/infrastructure/config";

export function initializeOtel(logger: Logger, clusterId: number) {
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
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [getNodeAutoInstrumentations()],
    resource: resource,
    sampler: new TraceIdRatioBasedSampler(config.tracing.samplePercentage),
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

  logger.info(
    {
      resource: resource.getRawAttributes(),
    },
    "opentelemetry initialized",
  );

  return sdk;
}

/**
 * Starts a new active span and automatically catches errors and ends the span.
 *
 * @param tracer
 * @param name
 * @param fn
 * @returns
 */
export function startCaughtActiveSpan<F extends (span?: Span) => unknown>(
  tracer: Tracer,
  name: string,
  fn: F,
): ReturnType<F> {
  return tracer.startActiveSpan(name, ((span: Span) => {
    try {
      return fn(span);
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : "Unknown error",
      });

      throw err;
    } finally {
      span.end();
    }
  }) as F);
}
