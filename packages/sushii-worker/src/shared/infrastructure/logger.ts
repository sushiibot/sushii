import { trace } from "@opentelemetry/api";
import pino from "pino";

import { config } from "@/shared/infrastructure/config";
import { knownSecretValues } from "@/shared/infrastructure/config/secrets";
import { createRedactionOptions } from "@/shared/infrastructure/logRedaction";

const logger = pino({
  ...createRedactionOptions(knownSecretValues),
  level: config.logging.level,
  formatters: {
    level(label) {
      return { level: label };
    },
    // A context `level` field would overwrite the severity that Loki alerts on.
    log(object) {
      if (!("level" in object)) {
        return object;
      }
      const { level, ...rest } = object;
      return { ...rest, contextLevel: level };
    },
  },
  mixin() {
    const spanContext = trace.getActiveSpan()?.spanContext();
    if (!spanContext?.traceId) {
      return {};
    }
    return {
      trace_id: spanContext.traceId,
      span_id: spanContext.spanId,
      trace_flags: spanContext.traceFlags,
    };
  },
});

logger.info(
  {
    logLevel: logger.level,
  },
  "Logger initialized",
);

/**
 *
 * @deprecated
 */
export const newModuleLogger = (module: string): pino.Logger =>
  logger.child({ module });

export default logger;
