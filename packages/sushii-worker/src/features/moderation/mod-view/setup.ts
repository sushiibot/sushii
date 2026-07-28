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

interface SetupModViewFeatureDeps {
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
  userLevelRepository: UserLevelRepository;
}

export interface ModViewFeatureServices {
  modViewService: ModViewService;
}

export function setupModViewFeature(
  deps: SetupModViewFeatureDeps,
): FullFeatureSetupReturn<ModViewFeatureServices> {
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

  const modViewDependencies: ModViewDependencies = {
    modViewService,
    emojiRepository: deps.emojiRepository,
    setNicknameService: deps.setNicknameService,
    logger: deps.logger.child({ feature: "modView" }),
  };

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
      modViewService,
    },
  };
}
