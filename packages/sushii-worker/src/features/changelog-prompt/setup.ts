import type { Client } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type * as schema from "@/infrastructure/database/schema";
import type { SelectMenuHandler } from "@/shared/presentation/handlers";
import type { BaseFeatureSetupReturn } from "@/shared/types/FeatureSetup";

import { ChangelogPromptService } from "./application/ChangelogPromptService";
import { DrizzleChangelogPromptRepository } from "./infrastructure/DrizzleChangelogPromptRepository";
import { ChangelogPromptEventHandler } from "./presentation/events/ChangelogPromptEventHandler";
import { ChangelogPromptButtonHandler } from "./presentation/handlers/ChangelogPromptButtonHandler";
import { ChangelogPromptSelectMenuHandler } from "./presentation/handlers/ChangelogPromptSelectMenuHandler";

interface ChangelogPromptDependencies {
  db: NodePgDatabase<typeof schema>;
  client: Client;
  logger: Logger;
}

interface ChangelogPromptFeatureSetup extends BaseFeatureSetupReturn {
  selectMenuHandlers: SelectMenuHandler[];
}

export function setupChangelogPromptFeature({
  db,
  client,
  logger,
}: ChangelogPromptDependencies): ChangelogPromptFeatureSetup {
  const repository = new DrizzleChangelogPromptRepository(db);
  const service = new ChangelogPromptService(
    repository,
    logger.child({ feature: "ChangelogPrompt" }),
  );

  const buttonHandler = new ChangelogPromptButtonHandler(
    service,
    logger.child({ module: "changelogPromptButton" }),
  );
  const selectMenuHandler = new ChangelogPromptSelectMenuHandler(
    service,
    client,
    logger.child({ module: "changelogPromptSelect" }),
  );
  const eventHandler = new ChangelogPromptEventHandler(service);

  return {
    commands: [],
    autocompletes: [],
    contextMenuHandlers: [],
    buttonHandlers: [buttonHandler],
    selectMenuHandlers: [selectMenuHandler],
    eventHandlers: [eventHandler],
  };
}
