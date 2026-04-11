import type { Client } from "discord.js";
import type { Events } from "discord.js";
import type { Logger } from "pino";

import type { EventHandler } from "@/core/cluster/presentation/EventHandler";
import type { BotEmojiRepository } from "@/features/bot-emojis/domain/repositories/BotEmojiRepository";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import { AutomodAlertCache } from "./application/AutomodAlertCache";
import { AutomodAlertReactionService } from "./application/AutomodAlertReactionService";
import { SpamActionService } from "./application/SpamActionService";
import { SpamDetectionService } from "./application/SpamDetectionService";
import { AutomodAlertExecutionHandler } from "./presentation/events/AutomodAlertExecutionHandler";
import { AutomodMessageHandler } from "./presentation/events/AutomodMessageHandler";

export interface AutomodFeature {
  eventHandlers: [AutomodMessageHandler, AutomodAlertExecutionHandler];
  services: {
    automodAlertReactionService: AutomodAlertReactionService;
  };
  destroy(): void;
}

export interface AutomodFeatureOptions {
  guildConfigRepository: GuildConfigRepository;
  emojiRepository: BotEmojiRepository;
  client: Client;
  logger: Logger;
}

export function setupAutomodFeature(
  options: AutomodFeatureOptions,
): AutomodFeature {
  const { guildConfigRepository, emojiRepository, client, logger } = options;

  // Services
  const spamDetectionService = new SpamDetectionService(
    logger.child({ component: "SpamDetectionService" }),
  );

  const spamActionService = new SpamActionService(
    client,
    logger.child({ component: "SpamActionService" }),
  );

  const automodAlertCache = new AutomodAlertCache();

  const automodAlertReactionService = new AutomodAlertReactionService(
    automodAlertCache,
    emojiRepository,
    logger.child({ component: "AutomodAlertReactionService" }),
  );

  // Event handlers
  const automodMessageHandler = new AutomodMessageHandler(
    spamDetectionService,
    spamActionService,
    guildConfigRepository,
    logger.child({ component: "AutomodMessageHandler" }),
  );

  const automodAlertExecutionHandler = new AutomodAlertExecutionHandler(
    automodAlertCache,
    logger.child({ component: "AutomodAlertExecutionHandler" }),
  );

  return {
    eventHandlers: [automodMessageHandler, automodAlertExecutionHandler],
    services: {
      automodAlertReactionService,
    },
    destroy: () => spamDetectionService.destroy(),
  };
}
