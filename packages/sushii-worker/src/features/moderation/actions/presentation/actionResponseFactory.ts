import type { Logger } from "pino";

import { COMMAND_CONFIGS } from "@/features/moderation/shared/presentation/commands/ModerationCommandConstants";
import type {
  ButtonHandler,
  SlashCommandHandler,
} from "@/shared/presentation/handlers";

import type { ModerationServices } from "../../setup";
import { ModerationCommand } from "./commands/ModerationCommand";
import { ActionResponseButtonHandler } from "./response/ActionResponseButtonHandler";

export function createActionResponseHandlers(
  services: ModerationServices,
  logger: Logger,
): {
  commands: SlashCommandHandler[];
  buttonHandlers: ButtonHandler[];
} {
  const commands: SlashCommandHandler[] = Object.values(COMMAND_CONFIGS).map(
    (config) =>
      new ModerationCommand(
        config,
        services.moderationService,
        services.targetResolutionService,
        services.guildConfigRepository,
        services.emojiRepository,
        services.reasonTemplateService,
        logger.child({ commandHandler: config.name }),
      ),
  );

  const buttonHandlers: ButtonHandler[] = [
    new ActionResponseButtonHandler({
      modLogRepository: services.modLogRepository,
      reasonUpdateService: services.reasonUpdateService,
      caseDmDeletionService: services.caseDmDeletionService,
      reasonTemplateService: services.reasonTemplateService,
      emojiRepository: services.emojiRepository,
      logger: logger.child({ buttonHandler: "actionResponse" }),
    }),
  ];

  return { commands, buttonHandlers };
}
