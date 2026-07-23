import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type * as schema from "@/infrastructure/database/schema";
import type { FeatureSetupWithTasks } from "@/shared/types/FeatureSetup";

import {
  LinkAccountsService,
  ListIdentitiesService,
  SetNicknameService,
  UnlinkAccountService,
  ViewIdentityService,
} from "./application";
import { DrizzleAltAccountRepository } from "./infrastructure";
import {
  AltNicknameButtonHandler,
  AltsCommand,
} from "./presentation";

interface SetupAltAccountsFeatureDeps {
  db: NodePgDatabase<typeof schema>;
  logger: Logger;
}

export function setupAltAccountsFeature(
  deps: SetupAltAccountsFeatureDeps,
): FeatureSetupWithTasks {
  const { db, logger } = deps;

  const altAccountRepository = new DrizzleAltAccountRepository(
    db,
    logger.child({ component: "DrizzleAltAccountRepository" }),
  );

  const linkAccountsService = new LinkAccountsService(
    altAccountRepository,
    logger.child({ component: "LinkAccountsService" }),
  );
  const unlinkAccountService = new UnlinkAccountService(
    altAccountRepository,
    logger.child({ component: "UnlinkAccountService" }),
  );
  const viewIdentityService = new ViewIdentityService(
    altAccountRepository,
    logger.child({ component: "ViewIdentityService" }),
  );
  const setNicknameService = new SetNicknameService(
    altAccountRepository,
    logger.child({ component: "SetNicknameService" }),
  );
  const listIdentitiesService = new ListIdentitiesService(
    altAccountRepository,
    logger.child({ component: "ListIdentitiesService" }),
  );

  const altsCommand = new AltsCommand(
    linkAccountsService,
    unlinkAccountService,
    viewIdentityService,
    setNicknameService,
    listIdentitiesService,
    logger.child({ component: "AltsCommand" }),
  );

  const altNicknameButtonHandler = new AltNicknameButtonHandler(
    setNicknameService,
    logger.child({ component: "AltNicknameButtonHandler" }),
  );

  return {
    commands: [altsCommand],
    autocompletes: [],
    contextMenuHandlers: [],
    buttonHandlers: [altNicknameButtonHandler],
    eventHandlers: [],
    tasks: [],
  };
}
