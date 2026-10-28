import type { Logger } from "pino";

import { ReasonAutocomplete } from "@/features/moderation/shared/presentation/autocomplete/ReasonAutocomplete";
import type {
  AutocompleteHandler,
  ButtonHandler,
  SlashCommandHandler,
} from "@/shared/presentation/handlers";

import type { ModerationServices } from "../../setup";
import {
  ReasonTemplateAutocomplete,
  loadReasonChoices,
} from "./autocomplete/ReasonTemplateAutocomplete";
import { ReasonTemplatesCommand } from "./commands/ReasonTemplatesCommand";
import { ReasonTemplatesPanelButtonHandler } from "./handlers/ReasonTemplatesPanelButtonHandler";
import { TemplateEditButtonHandler } from "./handlers/TemplateEditButtonHandler";

export function createReasonTemplateHandlers(
  services: ModerationServices,
  logger: Logger,
): {
  commands: SlashCommandHandler[];
  autocompletes: AutocompleteHandler[];
  buttonHandlers: ButtonHandler[];
} {
  const { reasonTemplateService, emojiRepository } = services;

  return {
    commands: [
      new ReasonTemplatesCommand(reasonTemplateService, emojiRepository),
    ],
    autocompletes: [
      new ReasonAutocomplete(
        services.caseRangeAutocompleteService,
        (guildId, input) =>
          loadReasonChoices(reasonTemplateService, guildId, input),
        logger.child({ autocompleteHandler: "reason" }),
      ),
      new ReasonTemplateAutocomplete(reasonTemplateService),
    ],
    buttonHandlers: [
      new ReasonTemplatesPanelButtonHandler(
        reasonTemplateService,
        emojiRepository,
        logger.child({ buttonHandler: "reasonTemplatesPanel" }),
      ),
      new TemplateEditButtonHandler(reasonTemplateService, emojiRepository),
    ],
  };
}
