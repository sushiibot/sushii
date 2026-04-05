import { metrics } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-grpc";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import {
  defaultResource,
  resourceFromAttributes,
} from "@opentelemetry/resources";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

// Standard OTel env vars (read automatically by the SDK):
//   OTEL_EXPORTER_OTLP_ENDPOINT     — gRPC collector (default: http://localhost:4317)
//   OTEL_EXPORTER_OTLP_HEADERS      — auth headers (key=value,key2=value2)
//   OTEL_SERVICE_NAME               — service name
//   OTEL_RESOURCE_ATTRIBUTES        — e.g. deployment.environment=production
//   OTEL_TRACES_SAMPLER / _ARG      — sampling (default: parentbased_always_on)
//
// Custom env vars (read manually below):
//   GIT_HASH                        — mapped to service.version
//   OTEL_METRIC_EXPORT_INTERVAL     — metric flush interval in ms (default 60000)
//                                     (PeriodicExportingMetricReader doesn't read this automatically)

export interface OtelSDK {
  tracerProvider: NodeTracerProvider;
  meterProvider: MeterProvider;
  shutdown: () => Promise<void>;
}

export function setupOtel(): OtelSDK {
  // defaultResource() already reads OTEL_SERVICE_NAME and OTEL_RESOURCE_ATTRIBUTES.
  // Merge GIT_HASH → service.version only when the env var is present.
  const resource = process.env.GIT_HASH
    ? defaultResource().merge(
        resourceFromAttributes({
          [ATTR_SERVICE_VERSION]: process.env.GIT_HASH,
        }),
      )
    : defaultResource();

  // ---------------------------------------------------------------------------
  // Traces
  // ---------------------------------------------------------------------------
  const traceExporter = new OTLPTraceExporter();
  const tracerProvider = new NodeTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(traceExporter)],
  });
  tracerProvider.register(); // also calls trace.setGlobalTracerProvider internally

  // ---------------------------------------------------------------------------
  // Metrics
  // ---------------------------------------------------------------------------
  const metricExporter = new OTLPMetricExporter();
  const parsed = parseInt(process.env.OTEL_METRIC_EXPORT_INTERVAL ?? "", 10);
  const exportIntervalMillis = Number.isNaN(parsed) ? 60_000 : parsed;

  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis,
      }),
    ],
  });
  metrics.setGlobalMeterProvider(meterProvider);

  const shutdown = async () => {
    await Promise.all([tracerProvider.shutdown(), meterProvider.shutdown()]);
  };

  return { tracerProvider, meterProvider, shutdown };
}
