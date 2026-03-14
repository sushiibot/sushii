import type { Client } from "discord.js";
import { Events } from "discord.js";
import type { Logger } from "pino";

import type { EventHandler } from "@/core/cluster/presentation/EventHandler";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import { SpamActionService } from "./application/SpamActionService";
import { SpamDetectionService } from "./application/SpamDetectionService";
import { AutomodMessageHandler } from "./presentation/events/AutomodMessageHandler";

export interface AutomodFeature {
  eventHandlers: EventHandler<typeof Events.Raw>[];
  destroy(): void;
}

export interface AutomodFeatureOptions {
  guildConfigRepository: GuildConfigRepository;
  client: Client;
  logger: Logger;
}

export function setupAutomodFeature(
  options: AutomodFeatureOptions,
): AutomodFeature {
  const { guildConfigRepository, client, logger } = options;

  // Services
  const spamDetectionService = new SpamDetectionService(
    logger.child({ component: "SpamDetectionService" }),
  );

  const spamActionService = new SpamActionService(
    client,
    logger.child({ component: "SpamActionService" }),
  );

  // Event handlers
  const automodMessageHandler = new AutomodMessageHandler(
    spamDetectionService,
    spamActionService,
    guildConfigRepository,
    logger.child({ component: "AutomodMessageHandler" }),
  );

  return {
    eventHandlers: [automodMessageHandler],
    destroy: () => spamDetectionService.destroy(),
  };
}
