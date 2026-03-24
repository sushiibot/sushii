import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain/repositories/BotEmojiRepository";
import type * as schema from "@/infrastructure/database/schema";
import type { FeatureSetupWithServices } from "@/shared/types/FeatureSetup";

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
  emojiRepository: BotEmojiRepository;
}

export function createTagServices({ db, logger }: Pick<TagDependencies, "db" | "logger">) {
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
  emojiRepository: BotEmojiRepository,
  logger: Logger,
) {
  const { tagService, tagSearchService, tagAdminService } = services;

  const tagEditInteractionHandler = new TagEditInteractionHandler(
    tagService,
    emojiRepository,
    logger.child({ module: "tagEditInteractionHandler" }),
  );

  const commands = [
    new TagInfoCommand(
      tagService,
      tagSearchService,
      emojiRepository,
      logger.child({ module: "tagInfoCommand" }),
    ),
    new TagEditCommand(
      tagService,
      tagEditInteractionHandler,
      emojiRepository,
      logger.child({ module: "tagEditCommand" }),
    ),
    new TagAddCommand(
      tagService,
      emojiRepository,
      logger.child({ module: "tagAddCommand" }),
    ),
    new TagGetCommand(
      tagService,
      emojiRepository,
      logger.child({ module: "tagGetCommand" }),
    ),
    new TagAdminCommand(
      tagAdminService,
      emojiRepository,
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
  emojiRepository,
}: TagDependencies): FeatureSetupWithServices<
  ReturnType<typeof createTagServices>
> {
  const services = createTagServices({ db, logger });
  const commands = createTagCommands(services, emojiRepository, logger);
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
