import type { Client } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import type * as schema from "@/infrastructure/database/schema";
import type { FeatureSetupWithTasks } from "@/shared/types/FeatureSetup";

import { MessageVerificationService } from "./application/MessageVerificationService";
import { DrizzleMessageVerificationRepository } from "./infrastructure/DrizzleMessageVerificationRepository";
import { MessageVerificationPurgeTask } from "./infrastructure/tasks/MessageVerificationPurgeTask";
import { SubmitToModsContextMenuHandler } from "./presentation/commands/SubmitToModsContextMenuHandler";
import { VerifyMessageCommand } from "./presentation/commands/VerifyMessageCommand";
import { VerifyMessageGuideCommand } from "./presentation/commands/VerifyMessageGuideCommand";

interface SetupMessageVerificationDeps {
  db: NodePgDatabase<typeof schema>;
  client: Client;
  deploymentService: DeploymentService;
  logger: Logger;
  applicationId: string;
}

export function setupMessageVerificationFeature(
  deps: SetupMessageVerificationDeps,
): FeatureSetupWithTasks {
  const { db, client, deploymentService, logger, applicationId } = deps;

  const repository = new DrizzleMessageVerificationRepository(db);

  const service = new MessageVerificationService(repository);

  const submitHandler = new SubmitToModsContextMenuHandler(
    service,
    logger.child({ component: "SubmitToModsContextMenuHandler" }),
  );

  const verifyCommand = new VerifyMessageCommand(
    service,
    logger.child({ component: "VerifyMessageCommand" }),
  );

  const guideCommand = new VerifyMessageGuideCommand(applicationId);

  const purgeTask = new MessageVerificationPurgeTask(
    client,
    deploymentService,
    service,
  );

  return {
    commands: [verifyCommand, guideCommand],
    autocompletes: [],
    contextMenuHandlers: [submitHandler],
    buttonHandlers: [],
    eventHandlers: [],
    tasks: [purgeTask],
  };
}
