import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain";
import type * as schema from "@/infrastructure/database/schema";
import type { FeatureSetupWithServices } from "@/shared/types/FeatureSetup";

import { DrizzleGuildConfigRepository } from "../../shared/infrastructure/DrizzleGuildConfigRepository";
import { DrizzleMessageLogBlockRepository } from "../message-log/infrastructure/DrizzleMessageLogBlockRepository";
import { GuildSettingsService } from "./application/GuildSettingsService";
import { MessageLogBlockService } from "./application/MessageLogBlockService";
import SettingsCommand from "./presentation/commands/SettingsCommand";

interface GuildSettingsDependencies {
  db: NodePgDatabase<typeof schema>;
  logger: Logger;
  botEmojiRepository: BotEmojiRepository;
}

export function createGuildSettingsServices({
  db,
  logger,
}: Pick<GuildSettingsDependencies, "db" | "logger">) {
  const guildConfigurationRepository = new DrizzleGuildConfigRepository(
    db,
    logger.child({ module: "guildConfigurationRepository" }),
  );

  const messageLogBlockRepository = new DrizzleMessageLogBlockRepository(
    db,
    logger.child({ module: "messageLogBlockRepository" }),
  );

  const guildSettingsService = new GuildSettingsService(
    guildConfigurationRepository,
    logger.child({ module: "guildSettingsService" }),
  );

  const messageLogBlockService = new MessageLogBlockService(
    messageLogBlockRepository,
    logger.child({ module: "messageLogBlockService" }),
  );

  return {
    guildConfigurationRepository,
    messageLogBlockRepository,
    guildSettingsService,
    messageLogBlockService,
  };
}

export function createGuildSettingsCommands(
  services: ReturnType<typeof createGuildSettingsServices>,
  logger: Logger,
  botEmojiRepository: BotEmojiRepository,
) {
  const { guildSettingsService, messageLogBlockService } = services;

  const commands = [
    new SettingsCommand(
      guildSettingsService,
      messageLogBlockService,
      logger.child({ module: "settingsCommand" }),
      botEmojiRepository,
    ),
  ];

  return {
    commands,
    autocompletes: [],
  };
}

export function createGuildSettingsEventHandlers(
  _services: ReturnType<typeof createGuildSettingsServices>,
  _logger: Logger,
) {
  // Guild settings feature doesn't have event handlers currently
  return {
    eventHandlers: [],
  };
}

export function setupGuildSettingsFeature({
  db,
  logger,
  botEmojiRepository,
}: GuildSettingsDependencies): FeatureSetupWithServices<
  ReturnType<typeof createGuildSettingsServices>
> {
  const services = createGuildSettingsServices({ db, logger });
  const commands = createGuildSettingsCommands(services, logger, botEmojiRepository);
  const events = createGuildSettingsEventHandlers(services, logger);

  return {
    services,
    commands: commands.commands,
    autocompletes: commands.autocompletes,
    contextMenuHandlers: [],
    buttonHandlers: [],
    eventHandlers: events.eventHandlers,
  };
}
