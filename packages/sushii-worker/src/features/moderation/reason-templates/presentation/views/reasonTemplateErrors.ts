import type { InteractionReplyOptions } from "discord.js";
import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from "discord.js";

import type { BotEmojiNameType, EmojiMap } from "@/features/bot-emojis/domain";
import Color from "@/utils/colors";

import type { ReasonTemplateError } from "../../application/ReasonTemplateService";
import { previewText } from "../../domain/ReasonExpander";

export const REASON_TEMPLATE_ERROR_EMOJIS = [
  "fail",
] as const satisfies readonly BotEmojiNameType[];

export type ReasonTemplateErrorEmojis = EmojiMap<
  typeof REASON_TEMPLATE_ERROR_EMOJIS
>;

const OWNER_PREVIEW_LENGTH = 90;

function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

function inlineCode(text: string): string {
  return `\`${text.replace(/`/g, "ˋ")}\``;
}

export function describeReasonTemplateError(
  error: ReasonTemplateError,
): string {
  switch (error.code) {
    case "empty":
      return "The template text can't be empty.";
    case "too_long":
      return `The template is ${formatCount(error.length)} characters; the limit is ${formatCount(error.max)}. Shorten it by ${formatCount(error.length - error.max)} characters.`;
    case "invalid_shortcut":
      return `${inlineCode(error.shortcut)} can't be a shortcut. Use letters, numbers, \`-\` and \`_\`, with no spaces.`;
    case "shortcut_taken":
      if (!error.owner) {
        return `${inlineCode(`!${error.shortcut}`)} is already used by another template. Pick a different shortcut.`;
      }

      return `${inlineCode(`!${error.shortcut}`)} is already the shortcut for:\n> ${previewText(error.owner.content, OWNER_PREVIEW_LENGTH)}\nPick a different shortcut, or edit that one in \`/reason-templates\`.`;
    case "duplicate":
      if (error.existing?.shortcut) {
        return `This text is already the template ${inlineCode(`!${error.existing.shortcut}`)}.`;
      }

      return "This text is already a template (no shortcut). Find it in the list to add one.";
    case "limit_reached":
      return `This server has ${formatCount(error.limit)} templates, the maximum. Delete one in \`/reason-templates\` to add more.`;
    case "not_found":
      return "That template was deleted.";
  }
}

export function buildReasonTemplateErrorMessage(
  error: ReasonTemplateError,
  emojis: ReasonTemplateErrorEmojis,
): InteractionReplyOptions {
  return buildErrorReply(describeReasonTemplateError(error), emojis);
}

export function buildErrorReply(
  text: string,
  emojis: ReasonTemplateErrorEmojis,
): InteractionReplyOptions {
  return {
    components: [
      new ContainerBuilder()
        .setAccentColor(Color.Error)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`${emojis.fail} ${text}`),
        ),
    ],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  };
}
