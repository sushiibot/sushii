import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type * as schema from "@/infrastructure/database/schema";
import type { BaseFeatureSetupReturn } from "@/shared/types/FeatureSetup";

import { MessageVerificationService } from "./application/MessageVerificationService";
import { DrizzleMessageVerificationRepository } from "./infrastructure/DrizzleMessageVerificationRepository";
import { SubmitToModsContextMenuHandler } from "./presentation/commands/SubmitToModsContextMenuHandler";
import { VerifyMessageCommand } from "./presentation/commands/VerifyMessageCommand";

interface SetupMessageVerificationDeps {
  db: NodePgDatabase<typeof schema>;
  logger: Logger;
}

export function setupMessageVerificationFeature(
  deps: SetupMessageVerificationDeps,
): BaseFeatureSetupReturn {
  const { db, logger } = deps;

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

  return {
    commands: [verifyCommand],
    autocompletes: [],
    contextMenuHandlers: [submitHandler],
    buttonHandlers: [],
    eventHandlers: [],
  };
}
