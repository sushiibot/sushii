import type { Client } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { FOLLOW_UPDATES_ID } from "@/features/prompts/definitions/followUpdates/message";
import { DrizzlePromptStateRepository } from "@/features/prompts/infrastructure/DrizzlePromptStateRepository";
import type * as schema from "@/infrastructure/database/schema";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";
import { SushiiNotificationService } from "@/shared/infrastructure/SushiiNotificationService";

import { SushiiUpdatesBackfillService } from "./application/SushiiUpdatesBackfillService";
import { SushiiUpdatesService } from "./application/SushiiUpdatesService";
import { DrizzleSushiiUpdatesRepository } from "./infrastructure/DrizzleSushiiUpdatesRepository";
import { SushiiUpdatesMetrics } from "./infrastructure/SushiiUpdatesMetrics";
import { SushiiUpdatesBackfillTask } from "./infrastructure/tasks/SushiiUpdatesBackfillTask";
import { BACKFILL_NOTICE } from "./presentation/updatesText";

interface SushiiUpdatesDependencies {
  client: Client;
  db: NodePgDatabase<typeof schema>;
  guildConfigRepository: GuildConfigRepository;
  deploymentService: DeploymentService;
  logger: Logger;
  /** Unset turns the whole feature off. */
  sourceChannelId: string | undefined;
}

export function setupSushiiUpdatesFeature({
  client,
  db,
  guildConfigRepository,
  deploymentService,
  logger,
  sourceChannelId,
}: SushiiUpdatesDependencies) {
  if (!sourceChannelId) {
    return { services: { sushiiUpdatesService: null }, tasks: [] };
  }

  const repository = new DrizzleSushiiUpdatesRepository(db);
  const promptStates = new DrizzlePromptStateRepository(db);
  const promptSubject = (guildId: string) =>
    ({ scope: "guild", id: BigInt(guildId) }) as const;
  const service = new SushiiUpdatesService(
    client.rest,
    sourceChannelId,
    repository,
    guildConfigRepository,
    new SushiiUpdatesMetrics(),
    {
      record: (guildId) =>
        promptStates.recordDismissed(promptSubject(guildId), FOLLOW_UPDATES_ID),
      isOptedOut: async (guildId) =>
        !!(await promptStates.find(promptSubject(guildId), FOLLOW_UPDATES_ID))
          ?.dismissedAt,
    },
    logger.child({ component: "SushiiUpdatesService" }),
  );

  const backfill = new SushiiUpdatesBackfillService(
    repository,
    service,
    new SushiiNotificationService(
      client,
      guildConfigRepository,
      logger.child({ component: "SushiiNotificationService" }),
    ),
    BACKFILL_NOTICE,
    logger.child({ component: "SushiiUpdatesBackfillService" }),
  );

  return {
    services: { sushiiUpdatesService: service },
    tasks: [
      new SushiiUpdatesBackfillTask(
        client,
        deploymentService,
        logger.child({ component: "SushiiUpdatesBackfillTask" }),
        backfill,
      ),
    ],
  };
}
