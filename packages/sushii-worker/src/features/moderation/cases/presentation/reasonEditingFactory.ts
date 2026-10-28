import type { Logger } from "pino";

import { AutomodAlertActionButtonHandler } from "@/features/moderation/actions/presentation/components/AutomodAlertActionButtonHandler";
import {
  ModLogDeleteDMButtonHandler,
  ModLogReasonButtonHandler,
} from "@/features/moderation/audit-logs/presentation/components";
import type {
  ButtonHandler,
  SlashCommandHandler,
} from "@/shared/presentation/handlers";

import type { ModerationServices } from "../../setup";
import { ReasonCommand } from "./commands/ReasonCommand";

export function createReasonEditingHandlers(
  services: ModerationServices,
  logger: Logger,
): {
  commands: SlashCommandHandler[];
  buttonHandlers: ButtonHandler[];
} {
  const commands: SlashCommandHandler[] = [
    new ReasonCommand(
      services.reasonUpdateService,
      services.reasonTemplateService,
      logger.child({ commandHandler: "reason" }),
    ),
  ];

  const buttonHandlers: ButtonHandler[] = [
    new ModLogReasonButtonHandler(
      services.modLogRepository,
      services.reasonUpdateService,
      services.reasonTemplateService,
      services.modLogMessageService,
      services.emojiRepository,
      logger.child({ buttonHandler: "modLogReason" }),
    ),
    new ModLogDeleteDMButtonHandler(
      services.modLogRepository,
      services.caseDmDeletionService,
      services.modLogMessageService,
      logger.child({ buttonHandler: "modLogDeleteDM" }),
    ),
    new AutomodAlertActionButtonHandler(
      services.moderationService,
      {
        reasonTemplateService: services.reasonTemplateService,
        emojiRepository: services.emojiRepository,
        logger: logger.child({ module: "automodAlertReasonForm" }),
      },
      logger.child({ buttonHandler: "automodAlertAction" }),
    ),
  ];

  return { commands, buttonHandlers };
}
