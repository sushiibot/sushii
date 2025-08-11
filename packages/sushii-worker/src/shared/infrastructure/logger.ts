import pino from "pino";

import { config } from "@/shared/infrastructure/config";

const logger = pino({
  level: config.logging.level,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});

logger.info(
  {
    level: logger.level,
  },
  "Logger initialized",
);

export const newModuleLogger = (module: string): pino.Logger =>
  logger.child({ module });

export default logger;
