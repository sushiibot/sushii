import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Logger } from "pino";

import * as schema from "@/infrastructure/database/schema";
import { FeatureSetupWithServices } from "@/shared/types/FeatureSetup";

import { TagAdminService, TagSearchService, TagService } from "./application";
import { DrizzleTagRepository } from "./infrastructure";
import {
  TagAddCommand,
  TagAdminCommand,
  TagAutocomplete,
  TagEditCommand,
  TagEditInteractionHandler,
  TagGetAutocomplete,
  TagGetCommand,
  TagInfoCommand,
} from "./presentation";

interface TagDependencies {
  db: NodePgDatabase<typeof schema>;
  logger: Logger;
}

export function createTagServices({ db, logger }: TagDependencies) {
  const tagRepository = new DrizzleTagRepository(
    db,
    logger.child({ module: "tags" }),
  );

  const tagService = new TagService(
    tagRepository,
    logger.child({ module: "tagService" }),
  );

  const tagSearchService = new TagSearchService(
    tagRepository,
    logger.child({ module: "tagSearchService" }),
  );

  const tagAdminService = new TagAdminService(
    tagRepository,
    logger.child({ module: "tagAdminService" }),
  );

  return {
    tagRepository,
    tagService,
    tagSearchService,
    tagAdminService,
  };
}

export function createTagCommands(
  services: ReturnType<typeof createTagServices>,
  logger: Logger,
) {
  const { tagService, tagSearchService, tagAdminService } = services;

  const tagEditInteractionHandler = new TagEditInteractionHandler(
    tagService,
    logger.child({ module: "tagEditInteractionHandler" }),
  );

  const commands = [
    new TagInfoCommand(
      tagService,
      tagSearchService,
      logger.child({ module: "tagInfoCommand" }),
    ),
    new TagEditCommand(
      tagService,
      tagEditInteractionHandler,
      logger.child({ module: "tagEditCommand" }),
    ),
    new TagAddCommand(tagService, logger.child({ module: "tagAddCommand" })),
    new TagGetCommand(tagService, logger.child({ module: "tagGetCommand" })),
    new TagAdminCommand(
      tagAdminService,
      logger.child({ module: "tagAdminCommand" }),
    ),
  ];

  const autocompletes = [
    new TagAutocomplete(
      tagSearchService,
      logger.child({ module: "tagAutocomplete" }),
    ),
    new TagGetAutocomplete(
      tagSearchService,
      logger.child({ module: "tagGetAutocomplete" }),
    ),
  ];

  return {
    commands,
    autocompletes,
    interactionHandlers: {
      tagEditInteractionHandler,
    },
  };
}

export function createTagEventHandlers(
  _services: ReturnType<typeof createTagServices>,
  _logger: Logger,
) {
  // Tags feature doesn't have event handlers currently
  return {
    eventHandlers: [],
  };
}

export function setupTagFeature({
  db,
  logger,
}: TagDependencies): FeatureSetupWithServices<
  ReturnType<typeof createTagServices>
> {
  const services = createTagServices({ db, logger });
  const commands = createTagCommands(services, logger);
  const events = createTagEventHandlers(services, logger);

  return {
    services,
    commands: commands.commands,
    autocompletes: commands.autocompletes,
    contextMenuHandlers: [],
    buttonHandlers: [],
    eventHandlers: events.eventHandlers,
  };
}
