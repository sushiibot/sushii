import type { ButtonInteraction } from "discord.js";
import { MessageFlags } from "discord.js";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain";
import { ButtonHandler } from "@/shared/presentation/handlers";
import {
  ANY_MOD_PERMISSION,
  requireMemberPermission,
} from "@/shared/presentation/requireMemberPermission";

import type { ReasonTemplateService } from "../../application/ReasonTemplateService";
import { buildModalId } from "../customIds";
import {
  REASON_TEMPLATES_EMOJIS,
  requireModOnSubmit,
  showAndAwaitModal,
} from "../templateModal";
import {
  buildTemplateSavedMessage,
  matchTemplateEditCustomId,
  parseTemplateEditButtonId,
} from "../templateSavedMessage";
import { buildReasonTemplateErrorMessage } from "../views/reasonTemplateErrors";
import {
  buildTemplateFormModal,
  readTemplateFields,
} from "../views/reasonTemplateModals";

/** Edit template on the "Template saved" reply sent after a form's Save as template checkbox. */
export class TemplateEditButtonHandler extends ButtonHandler {
  customIDMatch = matchTemplateEditCustomId;

  constructor(
    private readonly reasonTemplateService: Pick<
      ReasonTemplateService,
      "get" | "update"
    >,
    private readonly emojiRepository: Pick<BotEmojiRepository, "getEmojis">,
  ) {
    super();
  }

  async handleInteraction(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Must be in guild.");
    }

    const templateId = parseTemplateEditButtonId(interaction.customId);
    if (!templateId) {
      return;
    }

    if (
      !(await requireMemberPermission(
        interaction,
        ANY_MOD_PERMISSION.flags,
        ANY_MOD_PERMISSION.name,
      ))
    ) {
      return;
    }

    const emojis = await this.emojiRepository.getEmojis(
      REASON_TEMPLATES_EMOJIS,
    );
    const template = await this.reasonTemplateService.get(
      interaction.guildId,
      templateId,
    );
    if (!template) {
      await interaction.reply(
        buildReasonTemplateErrorMessage({ code: "not_found" }, emojis),
      );
      return;
    }

    const submit = await showAndAwaitModal(
      interaction,
      buildTemplateFormModal(buildModalId("editModal"), template),
    );
    if (!submit || !(await requireModOnSubmit(submit, emojis))) {
      return;
    }

    const updated = await this.reasonTemplateService.update(
      interaction.guildId,
      templateId,
      readTemplateFields(submit.fields),
      "checkbox",
    );
    if (updated.err) {
      await submit.reply(buildReasonTemplateErrorMessage(updated.val, emojis));
      return;
    }

    const message = buildTemplateSavedMessage(updated.val, emojis, {
      fromCheckbox: true,
    });
    if (submit.isFromMessage()) {
      // The ephemeral flag can't be sent on an update; the message stays ephemeral.
      await submit.update({ ...message, flags: MessageFlags.IsComponentsV2 });
    } else {
      await submit.reply(message);
    }
  }
}
