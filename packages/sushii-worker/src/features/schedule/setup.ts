import type { Client } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

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

interface SetupScheduleFeatureDeps {
  db: NodePgDatabase<typeof schema>;
  client: Client;
  deploymentService: DeploymentService;
  logger: Logger;
}

export function setupScheduleFeature(
  deps: SetupScheduleFeatureDeps,
): FeatureSetupWithTasks {
  const { db, client, deploymentService, logger } = deps;

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
  );

  const schedulePollService = new SchedulePollService(
    scheduleChannelRepository,
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
    scheduleChannelService,
    logger.child({ component: "ScheduleCommand" }),
  );

  const tasks = apiKey ? [schedulePollTask] : [];

  return {
    commands: [scheduleCommand],
    autocompletes: [],
    contextMenuHandlers: [],
    buttonHandlers: [],
    eventHandlers: [],
    tasks,
  };
}
