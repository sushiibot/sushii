import { trace } from "@opentelemetry/api";
import pino from "pino";

import { config } from "@/shared/infrastructure/config";

const logger = pino({
  level: config.logging.level,
  formatters: {
    level(label) {
      return { level: label };
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
    level: logger.level,
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
