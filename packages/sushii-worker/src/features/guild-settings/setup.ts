import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain";
import type { ScreeningSettingsPort } from "@/features/member-screening/application/ScreeningSettingsPort";
import type * as schema from "@/infrastructure/database/schema";
import type { FeatureSetupWithServices } from "@/shared/types/FeatureSetup";

import { DrizzleGuildConfigRepository } from "../../shared/infrastructure/DrizzleGuildConfigRepository";
import { DrizzleMessageLogBlockRepository } from "../message-log/infrastructure/DrizzleMessageLogBlockRepository";
import { GuildSettingsService } from "./application/GuildSettingsService";
import { MessageLogBlockService } from "./application/MessageLogBlockService";
import SettingsCommand from "./presentation/commands/SettingsCommand";

type GuildSettingsServices = ReturnType<typeof createGuildSettingsServices>;

interface GuildSettingsDependencies {
  /** Built early by the caller: other features need the config repository before screening exists. */
  services: GuildSettingsServices;
  logger: Logger;
  botEmojiRepository: BotEmojiRepository;
  screeningSettings: ScreeningSettingsPort | null;
}

export function createGuildSettingsServices({
  db,
  logger,
}: {
  db: NodePgDatabase<typeof schema>;
  logger: Logger;
}) {
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
  services: GuildSettingsServices,
  logger: Logger,
  botEmojiRepository: BotEmojiRepository,
  screeningSettings: ScreeningSettingsPort | null,
) {
  const { guildSettingsService, messageLogBlockService } = services;

  const commands = [
    new SettingsCommand(
      guildSettingsService,
      messageLogBlockService,
      logger.child({ module: "settingsCommand" }),
      botEmojiRepository,
      screeningSettings,
    ),
  ];

  return {
    commands,
    autocompletes: [],
  };
}

export function createGuildSettingsEventHandlers(
  _services: GuildSettingsServices,
  _logger: Logger,
) {
  // Guild settings feature doesn't have event handlers currently
  return {
    eventHandlers: [],
  };
}

export function setupGuildSettingsFeature({
  services,
  logger,
  botEmojiRepository,
  screeningSettings,
}: GuildSettingsDependencies): FeatureSetupWithServices<GuildSettingsServices> {
  const commands = createGuildSettingsCommands(
    services,
    logger,
    botEmojiRepository,
    screeningSettings,
  );
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
