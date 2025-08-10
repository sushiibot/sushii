import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type * as schema from "@/infrastructure/database/schema";
import { DrizzleGuildConfigRepository } from "@/shared/infrastructure/DrizzleGuildConfigRepository";
import type { FeatureSetupWithServices } from "@/shared/types/FeatureSetup";

import { JoinLeaveMessageService, MemberLogService } from "./application";
import { MessageTemplateService } from "./domain";
import { MemberJoinHandler, MemberLeaveHandler } from "./presentation";

interface MemberEventsDependencies {
  db: NodePgDatabase<typeof schema>;
  logger: Logger;
}

export function createMemberEventsServices({
  db,
  logger,
}: MemberEventsDependencies) {
  // Reuse the guild config repository from shared infrastructure
  const guildConfigRepository = new DrizzleGuildConfigRepository(
    db,
    logger.child({ module: "guildConfigRepository" }),
  );

  // Domain services
  const messageTemplateService = new MessageTemplateService();

  // Application services
  const memberLogService = new MemberLogService(
    guildConfigRepository,
    logger.child({ module: "memberLogService" }),
  );

  const joinLeaveMessageService = new JoinLeaveMessageService(
    guildConfigRepository,
    messageTemplateService,
    logger.child({ module: "joinLeaveMessageService" }),
  );

  return {
    guildConfigRepository,
    messageTemplateService,
    memberLogService,
    joinLeaveMessageService,
  };
}

export function createMemberEventsHandlers(
  services: ReturnType<typeof createMemberEventsServices>,
  logger: Logger,
) {
  const { memberLogService, joinLeaveMessageService } = services;

  const memberJoinHandler = new MemberJoinHandler(
    memberLogService,
    joinLeaveMessageService,
    logger.child({ module: "memberJoinHandler" }),
  );

  const memberLeaveHandler = new MemberLeaveHandler(
    memberLogService,
    joinLeaveMessageService,
    logger.child({ module: "memberLeaveHandler" }),
  );

  return {
    eventHandlers: [memberJoinHandler, memberLeaveHandler],
  };
}

export function setupMemberEventsFeature({
  db,
  logger,
}: MemberEventsDependencies): FeatureSetupWithServices<
  ReturnType<typeof createMemberEventsServices>
> {
  const services = createMemberEventsServices({ db, logger });
  const handlers = createMemberEventsHandlers(services, logger);

  return {
    services,
    commands: [],
    autocompletes: [],
    contextMenuHandlers: [],
    buttonHandlers: [],
    eventHandlers: handlers.eventHandlers,
  };
}