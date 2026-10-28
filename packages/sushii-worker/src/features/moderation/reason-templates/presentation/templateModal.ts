import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalBuilder,
  ModalSubmitInteraction,
} from "discord.js";
import { DiscordjsError, DiscordjsErrorCodes } from "discord.js";

import type { BotEmojiNameType, EmojiMap } from "@/features/bot-emojis/domain";
import { ANY_MOD_PERMISSION } from "@/shared/presentation/requireMemberPermission";

import { TEMPLATE_SAVED_EMOJIS } from "./templateSavedMessage";
import { REASON_TEMPLATES_PANEL_EMOJIS } from "./views/ReasonTemplatesPanelView";
import { REASON_TEMPLATE_ERROR_EMOJIS } from "./views/reasonTemplateErrors";
import { buildErrorReply } from "./views/reasonTemplateErrors";

export const REASON_TEMPLATES_EMOJIS = [
  ...REASON_TEMPLATES_PANEL_EMOJIS,
  ...REASON_TEMPLATE_ERROR_EMOJIS,
  ...TEMPLATE_SAVED_EMOJIS,
] as const satisfies readonly BotEmojiNameType[];

export type ReasonTemplatesEmojis = EmojiMap<typeof REASON_TEMPLATES_EMOJIS>;

const MODAL_TIME_MS = 10 * 60 * 1000;

export type ModalOpener =
  | ButtonInteraction<"cached">
  | ChatInputCommandInteraction<"cached">;

/** Shows the form and waits for its submit; null when it timed out or was dismissed. */
export async function showAndAwaitModal(
  interaction: ModalOpener,
  modal: ModalBuilder,
): Promise<ModalSubmitInteraction<"cached"> | null> {
  const customId = modal.data.custom_id;

  await interaction.showModal(modal);

  try {
    return await interaction.awaitModalSubmit({
      time: MODAL_TIME_MS,
      filter: (i) =>
        i.customId === customId && i.user.id === interaction.user.id,
    });
  } catch (err) {
    // Ends without a submit on timeout; a dismissed form looks the same.
    if (
      err instanceof DiscordjsError &&
      err.code === DiscordjsErrorCodes.InteractionCollectorError
    ) {
      return null;
    }

    throw err;
  }
}

/** Re-checks on submit, since permissions can change while the form is open. */
export async function requireModOnSubmit(
  submit: ModalSubmitInteraction<"cached">,
  emojis: ReasonTemplatesEmojis,
): Promise<boolean> {
  if (submit.memberPermissions.any(ANY_MOD_PERMISSION.flags)) {
    return true;
  }

  await submit.reply(
    buildErrorReply(
      `You need **${ANY_MOD_PERMISSION.name}** to do that.`,
      emojis,
    ),
  );

  return false;
}
