import type { Client } from "discord.js";
import type { Logger } from "pino";

import type { SetNicknameService } from "@/features/alt-accounts/application/SetNicknameService";
import type { AltAccountRepository } from "@/features/alt-accounts/domain/repositories";
import type { BotEmojiRepository } from "@/features/bot-emojis";
import type { UserLevelRepository } from "@/features/leveling/domain/repositories/UserLevelRepository";
import type { FullFeatureSetupReturn } from "@/shared/types/FeatureSetup";

import type { HistoryUserService } from "../cases/application/HistoryUserService";
import type { LookupUserService } from "../cases/application/LookupUserService";
import type { NamesUserService } from "../cases/application/NamesUserService";
import type { TempBanRepository } from "../shared/domain/repositories/TempBanRepository";
import type { TimeoutDetectionService } from "../shared/domain/services/TimeoutDetectionService";
import { ModViewService } from "./application/ModViewService";
import type { ModViewDependencies } from "./presentation/ModViewSession";
import { ModViewCommand } from "./presentation/commands/ModViewCommand";
import { ModViewContextMenuHandler } from "./presentation/commands/ModViewContextMenuHandler";

interface CreateModViewDependenciesDeps {
  client: Client;
  logger: Logger;
  emojiRepository: BotEmojiRepository;
  historyUserService: HistoryUserService;
  lookupUserService: LookupUserService;
  namesUserService: NamesUserService;
  altAccountRepository: AltAccountRepository;
  tempBanRepository: TempBanRepository;
  timeoutDetectionService: TimeoutDetectionService;
  setNicknameService: SetNicknameService;
}

export interface ModViewFeatureServices {
  modViewService: ModViewService;
}

/**
 * Built ahead of `setupModViewFeature` so the deep-linking commands
 * (`/history`, `/names`, `/lookup`, `/alts view`) can be constructed with the
 * same `ModViewDependencies` instance, wherever their own feature setup runs.
 */
export function createModViewDependencies(
  deps: CreateModViewDependenciesDeps,
): ModViewDependencies {
  const modViewService = new ModViewService(
    deps.client,
    deps.historyUserService,
    deps.lookupUserService,
    deps.namesUserService,
    deps.altAccountRepository,
    deps.tempBanRepository,
    deps.timeoutDetectionService,
    deps.logger.child({ module: "modViewService" }),
  );

  return {
    modViewService,
    emojiRepository: deps.emojiRepository,
    setNicknameService: deps.setNicknameService,
    logger: deps.logger.child({ feature: "modView" }),
  };
}

interface SetupModViewFeatureDeps {
  modViewDependencies: ModViewDependencies;
  userLevelRepository: UserLevelRepository;
}

export function setupModViewFeature(
  deps: SetupModViewFeatureDeps,
): FullFeatureSetupReturn<ModViewFeatureServices> {
  const { modViewDependencies } = deps;

  return {
    commands: [new ModViewCommand(modViewDependencies)],
    autocompletes: [],
    contextMenuHandlers: [
      new ModViewContextMenuHandler(
        modViewDependencies,
        deps.userLevelRepository,
      ),
    ],
    buttonHandlers: [],
    eventHandlers: [],
    tasks: [],
    services: {
      modViewService: modViewDependencies.modViewService,
    },
  };
}
