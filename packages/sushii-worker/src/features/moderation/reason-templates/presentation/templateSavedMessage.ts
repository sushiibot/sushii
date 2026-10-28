import type { InteractionReplyOptions } from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
} from "discord.js";

import type { BotEmojiNameType, EmojiMap } from "@/features/bot-emojis/domain";
import {
  TEXT_DISPLAY_MAX_LENGTH,
  quoteLines,
} from "@/features/moderation/shared/presentation/reasonFields";
import Color from "@/utils/colors";

import type { ReasonTemplate } from "../domain/ReasonTemplate";

export const TEMPLATE_SAVED_EMOJIS = [
  "success",
  "message_edit",
] as const satisfies readonly BotEmojiNameType[];

const TEMPLATE_EDIT_PREFIX = "reasonTemplates:edit:";

export function buildTemplateEditButtonId(templateId: string): string {
  return `${TEMPLATE_EDIT_PREFIX}${templateId}`;
}

export function parseTemplateEditButtonId(customId: string): string | null {
  if (!customId.startsWith(TEMPLATE_EDIT_PREFIX)) {
    return null;
  }

  const id = customId.slice(TEMPLATE_EDIT_PREFIX.length);
  return /^\d+$/.test(id) ? id : null;
}

/** Fits MessageComponentHandler.customIDMatch, which the router calls with the customId. */
export function matchTemplateEditCustomId(
  customId: string,
): { path: string; index: number; params: { templateId: string } } | false {
  const templateId = parseTemplateEditButtonId(customId);

  return templateId !== null
    ? { path: customId, index: 0, params: { templateId } }
    : false;
}

export function buildTemplateSavedMessage(
  template: ReasonTemplate,
  emojis: EmojiMap<typeof TEMPLATE_SAVED_EMOJIS>,
  options: { fromCheckbox: boolean },
): InteractionReplyOptions {
  let hint: string;
  if (template.shortcut) {
    hint = `Type \`!${template.shortcut}\` at the start of a reason, or pick it from the reason autocomplete and reason forms.`;
  } else if (options.fromCheckbox) {
    hint = "Pick it from the reason autocomplete and reason forms.";
  } else {
    hint =
      "Pick it from the reason autocomplete and reason forms. Add a shortcut in `/reason-templates`.";
  }

  const icon = emojis.success ? `${emojis.success} ` : "";
  const heading = `### ${icon}Template saved\n`;
  const footer = `\n-# ${hint}`;
  const quoted = quoteLines(
    template.content,
    TEXT_DISPLAY_MAX_LENGTH - heading.length - footer.length,
  );

  const container = new ContainerBuilder()
    .setAccentColor(Color.Success)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(heading + quoted + footer),
    );

  if (options.fromCheckbox) {
    const editButton = new ButtonBuilder()
      .setCustomId(buildTemplateEditButtonId(template.id))
      .setLabel("Edit template")
      .setStyle(ButtonStyle.Secondary);
    // A missing bot emoji comes back as "", which setEmoji rejects.
    if (emojis.message_edit) {
      editButton.setEmoji(emojis.message_edit);
    }
    container.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(editButton),
    );
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  };
}
