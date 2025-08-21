import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type * as schema from "@/infrastructure/database/schema";
import type { SelectMenuHandler } from "@/shared/presentation/handlers";
import type { FullFeatureSetupReturn } from "@/shared/types/FeatureSetup";

import {
  RoleMenuInteractionService,
  RoleMenuManagementService,
  RoleMenuRoleService,
} from "./application";
import { DrizzleRoleMenuRepository } from "./infrastructure/repositories/DrizzleRoleMenuRepository";
import { RoleMenuCommand } from "./presentation/commands/RoleMenuCommand";
import { RoleMenuAutocomplete } from "./presentation/handlers/RoleMenuAutocomplete";
import { RoleMenuButtonHandler } from "./presentation/handlers/RoleMenuButtonHandler";
import { RoleMenuSelectMenuHandler } from "./presentation/handlers/RoleMenuSelectMenuHandler";

interface RoleMenuDependencies {
  db: NodePgDatabase<typeof schema>;
  logger: Logger;
}

interface RoleMenuFeatureSetupReturn<TServices = unknown>
  extends FullFeatureSetupReturn<TServices> {
  /** Select menu handlers (role menu is the first feature to need these) */
  selectMenuHandlers: SelectMenuHandler[];
}

export function createRoleMenuServices({ db, logger }: RoleMenuDependencies) {
  const roleMenuRepository = new DrizzleRoleMenuRepository(
    db,
    logger.child({ module: "roleMenuRepository" }),
  );

  const roleMenuManagementService = new RoleMenuManagementService(
    roleMenuRepository,
    logger.child({ module: "roleMenuManagementService" }),
  );

  const roleMenuRoleService = new RoleMenuRoleService(
    roleMenuRepository,
    logger.child({ module: "roleMenuRoleService" }),
  );

  const roleMenuInteractionService = new RoleMenuInteractionService(
    logger.child({ module: "roleMenuInteractionService" }),
  );

  return {
    roleMenuRepository,
    roleMenuManagementService,
    roleMenuRoleService,
    roleMenuInteractionService,
  };
}

export function createRoleMenuCommands(
  services: ReturnType<typeof createRoleMenuServices>,
  logger: Logger,
) {
  const {
    roleMenuManagementService,
    roleMenuRoleService,
    roleMenuInteractionService,
  } = services;

  const commands = [
    new RoleMenuCommand(
      roleMenuManagementService,
      roleMenuRoleService,
      logger.child({ commandHandler: "rolemenu" }),
    ),
  ];

  const autocompletes = [
    new RoleMenuAutocomplete(
      roleMenuManagementService,
      logger.child({ autocompleteHandler: "rolemenu" }),
    ),
  ];

  const buttonHandlers = [
    new RoleMenuButtonHandler(
      roleMenuInteractionService,
      logger.child({ buttonHandler: "rolemenu" }),
    ),
  ];

  const selectMenuHandlers = [
    new RoleMenuSelectMenuHandler(
      roleMenuInteractionService,
      logger.child({ selectMenuHandler: "rolemenu" }),
    ),
  ];

  return {
    commands,
    autocompletes,
    buttonHandlers,
    selectMenuHandlers,
  };
}

export function setupRoleMenuFeature({
  db,
  logger,
}: RoleMenuDependencies): RoleMenuFeatureSetupReturn<
  ReturnType<typeof createRoleMenuServices>
> {
  const services = createRoleMenuServices({ db, logger });
  const handlers = createRoleMenuCommands(services, logger);

  return {
    services,
    commands: handlers.commands,
    autocompletes: handlers.autocompletes,
    contextMenuHandlers: [],
    buttonHandlers: handlers.buttonHandlers,
    selectMenuHandlers: handlers.selectMenuHandlers,
    eventHandlers: [],
    tasks: [],
  };
}
