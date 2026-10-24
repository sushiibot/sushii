import { createRedactionOptions } from "@sushiibot/sushii-worker/logRedaction";
import pino from "pino";

import { config } from "./config.ts";
import { knownSecretValues } from "./secrets.ts";

export const logger = pino({
  ...createRedactionOptions(knownSecretValues),
  level: config.logLevel,
});
