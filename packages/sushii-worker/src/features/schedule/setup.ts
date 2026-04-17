import type { Client } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain";
import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import type * as schema from "@/infrastructure/database/schema";
import type { FeatureSetupWithTasks } from "@/shared/types/FeatureSetup";
import { config } from "@/shared/infrastructure/config/config";

import { CalendarSyncService } from "./application/CalendarSyncService";
import { DiscordSchedulePublisher } from "./application/DiscordSchedulePublisher";
import { ScheduleChannelService } from "./application/ScheduleChannelService";
import { SchedulePollService } from "./application/SchedulePollService";
import { GoogleCalendarClient } from "./infrastructure/google/GoogleCalendarClient";
import { ScheduleMetrics } from "./infrastructure/metrics/ScheduleMetrics";
import { DrizzleScheduleRepository } from "./infrastructure/repositories/DrizzleScheduleRepository";
import { SchedulePollTask } from "./infrastructure/tasks/SchedulePollTask";
import { ScheduleConfigAutocomplete } from "./presentation/autocompletes/ScheduleConfigAutocomplete";
import { ScheduleCommand } from "./presentation/commands/ScheduleCommand";
import { ScheduleConfigCommand } from "./presentation/commands/ScheduleConfigCommand";
import { ScheduleConfigDeleteButtonHandler } from "./presentation/handlers/ScheduleConfigDeleteButtonHandler";
import { ScheduleConfigNewButtonHandler } from "./presentation/handlers/ScheduleConfigNewButtonHandler";

interface SetupScheduleFeatureDeps {
  db: NodePgDatabase<typeof schema>;
  client: Client;
  deploymentService: DeploymentService;
  logger: Logger;
  emojiRepository: BotEmojiRepository;
}

export function setupScheduleFeature(
  deps: SetupScheduleFeatureDeps,
): FeatureSetupWithTasks {
  const { db, client, deploymentService, logger, emojiRepository } = deps;

  const apiKey = config.googleCalendarApiKey;
  if (!apiKey) {
    deps.logger.warn(
      "GOOGLE_CALENDAR_API_KEY is not set — schedule channel feature will not function. Set the env var and restart.",
    );
  }

  const scheduleMetrics = new ScheduleMetrics();

  const calendarClient = new GoogleCalendarClient(
    apiKey ?? "",
    logger.child({ component: "GoogleCalendarClient" }),
  );

  const scheduleRepository = new DrizzleScheduleRepository(
    db,
    logger.child({ component: "DrizzleScheduleRepository" }),
  );

  const calendarSyncService = new CalendarSyncService(
    calendarClient,
    scheduleRepository, // implements ScheduleEventRepository
    logger.child({ component: "CalendarSyncService" }),
  );

  const discordSchedulePublisher = new DiscordSchedulePublisher(
    scheduleRepository, // implements ScheduleMessageRepository
    client,
    logger.child({ component: "DiscordSchedulePublisher" }),
    emojiRepository,
    scheduleMetrics,
  );

  const schedulePollService = new SchedulePollService(
    scheduleRepository, // ScheduleRepository
    scheduleRepository, // ScheduleMessageRepository
    scheduleRepository, // ScheduleEventRepository
    calendarSyncService,
    discordSchedulePublisher,
    logger.child({ component: "SchedulePollService" }),
    scheduleMetrics,
  );

  const scheduleChannelService = new ScheduleChannelService(
    scheduleRepository,
    calendarClient,
    !!apiKey,
    logger.child({ component: "ScheduleChannelService" }),
  );

  const schedulePollTask = new SchedulePollTask(
    client,
    deploymentService,
    logger.child({ component: "SchedulePollTask" }),
    schedulePollService,
  );

  const scheduleCommand = new ScheduleCommand(
    scheduleRepository, // implements ScheduleEventRepository
    logger.child({ component: "ScheduleCommand" }),
  );

  const scheduleConfigCommand = new ScheduleConfigCommand(
    scheduleChannelService,
    logger.child({ component: "ScheduleConfigCommand" }),
    emojiRepository,
  );

  const scheduleConfigNewButtonHandler = new ScheduleConfigNewButtonHandler(
    scheduleChannelService,
    logger.child({ component: "ScheduleConfigNewButtonHandler" }),
    emojiRepository,
  );

  const scheduleConfigDeleteButtonHandler = new ScheduleConfigDeleteButtonHandler(
    scheduleChannelService,
    logger.child({ component: "ScheduleConfigDeleteButtonHandler" }),
    emojiRepository,
  );

  const scheduleConfigAutocomplete = new ScheduleConfigAutocomplete(
    scheduleChannelService,
    logger.child({ component: "ScheduleConfigAutocomplete" }),
  );

  const tasks = apiKey ? [schedulePollTask] : [];

  return {
    commands: [scheduleCommand, scheduleConfigCommand],
    autocompletes: [scheduleConfigAutocomplete],
    contextMenuHandlers: [],
    buttonHandlers: [scheduleConfigNewButtonHandler, scheduleConfigDeleteButtonHandler],
    eventHandlers: [],
    tasks,
  };
}
