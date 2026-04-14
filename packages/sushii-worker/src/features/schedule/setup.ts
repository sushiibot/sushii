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
import { DrizzleScheduleChannelRepository } from "./infrastructure/repositories/DrizzleScheduleChannelRepository";
import { SchedulePollTask } from "./infrastructure/tasks/SchedulePollTask";
import { ScheduleCommand } from "./presentation/commands/ScheduleCommand";
import { ScheduleConfigCommand } from "./presentation/commands/ScheduleConfigCommand";

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
  const calendarClient = new GoogleCalendarClient(apiKey ?? "");

  const scheduleChannelRepository = new DrizzleScheduleChannelRepository(
    db,
    logger.child({ component: "DrizzleScheduleChannelRepository" }),
  );

  const calendarSyncService = new CalendarSyncService(
    calendarClient,
    logger.child({ component: "CalendarSyncService" }),
  );

  const discordSchedulePublisher = new DiscordSchedulePublisher(
    scheduleChannelRepository,
    client,
    logger.child({ component: "DiscordSchedulePublisher" }),
    emojiRepository,
  );

  const schedulePollService = new SchedulePollService(
    scheduleChannelRepository,  // ScheduleChannelRepository
    scheduleChannelRepository,  // ScheduleMessageRepository
    calendarSyncService,
    discordSchedulePublisher,
    logger.child({ component: "SchedulePollService" }),
  );

  const scheduleChannelService = new ScheduleChannelService(
    scheduleChannelRepository,
    calendarClient,
    schedulePollService,
    !!apiKey,   // isConfigured
    logger.child({ component: "ScheduleChannelService" }),
  );

  const schedulePollTask = new SchedulePollTask(
    client,
    deploymentService,
    logger.child({ component: "SchedulePollTask" }),
    schedulePollService,
  );

  const scheduleCommand = new ScheduleCommand(
    scheduleChannelRepository,
    calendarClient,
    logger.child({ component: "ScheduleCommand" }),
  );

  const scheduleConfigCommand = new ScheduleConfigCommand(
    scheduleChannelService,
    logger.child({ component: "ScheduleConfigCommand" }),
    emojiRepository,
  );

  const tasks = apiKey ? [schedulePollTask] : [];

  return {
    commands: [scheduleCommand, scheduleConfigCommand],
    autocompletes: [],
    contextMenuHandlers: [],
    buttonHandlers: [],
    eventHandlers: [],
    tasks,
  };
}
