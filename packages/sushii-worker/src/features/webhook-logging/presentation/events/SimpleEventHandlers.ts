import type { ClientEvents } from "discord.js";
import { Events } from "discord.js";
import type { Logger } from "pino";

import type {
  EventArgs,
  EventType,
} from "@/core/cluster/presentation/EventHandler";
import { EventHandler } from "@/core/cluster/presentation/EventHandler";

// Simple utility to create basic logging handlers
export function createLogOnlyHandler<T extends EventType>(
  eventType: T,
  logger: Logger,
  message: string,
  logLevel: "info" | "debug" | "error" = "info",
): EventHandler<T> {
  return new (class extends EventHandler<T> {
    readonly eventType = eventType;
    async handle(...args: EventArgs<T>): Promise<void> {
      logger[logLevel]({}, message, ...args);
    }
  })();
}

// Pre-made handlers for the simple cases
export const createDebugHandler = (logger: Logger) =>
  createLogOnlyHandler(Events.Debug, logger, "Debug:", "debug");

export const createShardReconnectingHandler = (logger: Logger) =>
  createLogOnlyHandler(Events.ShardReconnecting, logger, "Shard reconnecting");

export const createShardResumeHandler = (logger: Logger) =>
  createLogOnlyHandler(Events.ShardResume, logger, "Shard resumed");
