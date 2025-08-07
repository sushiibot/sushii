import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Logger } from "pino";

import * as schema from "@/infrastructure/database/schema";
import { FeatureSetupWithServices } from "@/shared/types/FeatureSetup";

import { DrizzleGuildConfigRepository } from "../../shared/infrastructure/DrizzleGuildConfigRepository";
import { GuildSettingsService } from "./application/GuildSettingsService";
import { MessageLogService } from "./application/MessageLogService";
import { DrizzleMessageLogBlockRepository } from "./infrastructure/DrizzleMessageLogBlockRepository";
import SettingsCommand from "./presentation/commands/SettingsCommand";

interface GuildSettingsDependencies {
  db: NodePgDatabase<typeof schema>;
  logger: Logger;
}

export function createGuildSettingsServices({
  db,
  logger,
}: GuildSettingsDependencies) {
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

  const messageLogService = new MessageLogService(
    messageLogBlockRepository,
    logger.child({ module: "messageLogService" }),
  );

  return {
    guildConfigurationRepository,
    messageLogBlockRepository,
    guildSettingsService,
    messageLogService,
  };
}

export function createGuildSettingsCommands(
  services: ReturnType<typeof createGuildSettingsServices>,
  logger: Logger,
) {
  const { guildSettingsService, messageLogService } = services;

  const commands = [
    new SettingsCommand(
      guildSettingsService,
      messageLogService,
      logger.child({ module: "settingsCommand" }),
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
}: GuildSettingsDependencies): FeatureSetupWithServices<
  ReturnType<typeof createGuildSettingsServices>
> {
  const services = createGuildSettingsServices({ db, logger });
  const commands = createGuildSettingsCommands(services, logger);
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
