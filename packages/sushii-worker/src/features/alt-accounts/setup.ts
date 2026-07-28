import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type { ModViewDependencies } from "@/features/moderation/mod-view/presentation/ModViewEntry";
import type * as schema from "@/infrastructure/database/schema";
import type { FullFeatureSetupReturn } from "@/shared/types/FeatureSetup";

import {
  LinkAccountsService,
  ListIdentitiesService,
  SetNicknameService,
  UnlinkAccountService,
} from "./application";
import type { AltAccountRepository } from "./domain/repositories";
import { DrizzleAltAccountRepository } from "./infrastructure";
import { AltNicknameButtonHandler, AltsCommand } from "./presentation";

interface CreateAltAccountsServicesDeps {
  db: NodePgDatabase<typeof schema>;
  logger: Logger;
}

export interface AltAccountsFeatureServices {
  altAccountRepository: AltAccountRepository;
  /** Shared with the mod view's in-tab identity rename, which writes through the same service. */
  setNicknameService: SetNicknameService;
}

/**
 * Built ahead of `setupAltAccountsFeature` — `moderation/setup.ts` needs
 * `altAccountRepository`/`setNicknameService` to build its `ModViewService`
 * before `AltsCommand` (which deep-links into the mod view) can be
 * constructed, so the two halves can't be built in one pass.
 */
export function createAltAccountsServices(deps: CreateAltAccountsServicesDeps) {
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
  const setNicknameService = new SetNicknameService(
    altAccountRepository,
    logger.child({ component: "SetNicknameService" }),
  );
  const listIdentitiesService = new ListIdentitiesService(
    altAccountRepository,
    logger.child({ component: "ListIdentitiesService" }),
  );

  return {
    altAccountRepository,
    linkAccountsService,
    unlinkAccountService,
    setNicknameService,
    listIdentitiesService,
  };
}

interface SetupAltAccountsFeatureDeps {
  logger: Logger;
  services: ReturnType<typeof createAltAccountsServices>;
  modViewDependencies: ModViewDependencies;
}

export function setupAltAccountsFeature(
  deps: SetupAltAccountsFeatureDeps,
): FullFeatureSetupReturn<AltAccountsFeatureServices> {
  const { logger, services, modViewDependencies } = deps;
  const {
    altAccountRepository,
    linkAccountsService,
    unlinkAccountService,
    setNicknameService,
    listIdentitiesService,
  } = services;

  const altsCommand = new AltsCommand(
    linkAccountsService,
    unlinkAccountService,
    setNicknameService,
    listIdentitiesService,
    modViewDependencies,
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
    services: {
      altAccountRepository,
      setNicknameService,
    },
  };
}
