import type { Span, Tracer } from "@opentelemetry/api";
import opentelemetry from "@opentelemetry/api";
import { SpanStatusCode } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import {
  defaultResource,
  resourceFromAttributes,
} from "@opentelemetry/resources";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { TraceIdRatioBasedSampler } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import type { Logger } from "pino";

import { config } from "@/shared/infrastructure/config";

export function initializeOtel(logger: Logger) {
  const exporterOptions = {
    // Default URL
    url: config.tracing.exporterUrl || "http://localhost:4318/v1/traces",
  };

  const resource = defaultResource().merge(
    resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "sushii_worker",
      // No version yet
      // [ATTR_SERVICE_VERSION]: "v1.0.0"
    }),
  );

  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter(exporterOptions),
    instrumentations: [getNodeAutoInstrumentations()],
    resource: resource,
    sampler: new TraceIdRatioBasedSampler(config.tracing.samplePercentage),
  });

  // Configured via env vars, e.g. `OTEL_EXPORTER_OTLP_ENDPOINT`
  const metricExporter = new OTLPMetricExporter();
  const meterProvider = new MeterProvider({
    resource: resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 60_000,
      }),
    ],
  });

  // Set this MeterProvider to be global to the app being instrumented.
  opentelemetry.metrics.setGlobalMeterProvider(meterProvider);

  // initialize the SDK and register with the OpenTelemetry API
  // this enables the API to record telemetry
  sdk.start();
  logger.info(exporterOptions, "Tracing initialized");

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
