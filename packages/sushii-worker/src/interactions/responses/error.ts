import {
  EmbedBuilder,
  ButtonInteraction,
  ChatInputCommandInteraction,
  InteractionReplyOptions,
  ModalSubmitInteraction,
  InteractionEditReplyOptions,
} from "discord.js";
import { MessageFlags } from "discord.js";
import { t } from "i18next";
import Color from "../../utils/colors";

type ReplyableInteraction =
  | ChatInputCommandInteraction
  | ButtonInteraction
  | ModalSubmitInteraction;

export function getErrorMessageEmbeds(
  title: string,
  description: string,
): EmbedBuilder[] {
  return [
    new EmbedBuilder()
      .setTitle(title || "Error")
      .setDescription(description || "An error occurred")
      .setColor(Color.Error),
  ];
}

export function getErrorMessage(
  title: string,
  description: string,
  ephemeral: boolean = false,
): InteractionReplyOptions {
  return {
    embeds: getErrorMessageEmbeds(title, description),
    flags: ephemeral ? MessageFlags.Ephemeral : undefined,
  };
}

export function getErrorMessageEdit(
  title: string,
  description: string,
): InteractionEditReplyOptions {
  return {
    embeds: getErrorMessageEmbeds(title, description),
  };
}

export async function interactionReplyError(
  interaction: ReplyableInteraction,
  title: string,
  description: string,
  ephemeral: boolean = false,
): Promise<void> {
  await interaction.reply(getErrorMessage(title, description, ephemeral));
}

export async function interactionReplyErrorPermission(
  interaction: ReplyableInteraction,
  permission: string,
): Promise<void> {
  return interactionReplyError(
    interaction,
    t("generic.error.error", { ns: "commands" }),
    t("generic.error.no_permission", { ns: "commands", permission }),
  );
}

export async function interactionReplyErrorUnauthorized(
  interaction: ReplyableInteraction,
  message: string,
): Promise<void> {
  return interactionReplyError(
    interaction,
    t("generic.error.error", { ns: "commands" }),
    t("generic.error.unauthorized_target", { ns: "commands", message }),
  );
}

export async function interactionReplyErrorMessage(
  interaction: ReplyableInteraction,
  message: string,
  ephemeral: boolean = false,
): Promise<void> {
  return interactionReplyError(
    interaction,
    t("generic.error.error", { ns: "commands" }),
    t("generic.error.message", { ns: "commands", message }),
    ephemeral,
  );
}

export async function interactionReplyErrorPlainMessage(
  interaction: ReplyableInteraction,
  message: string,
  ephemeral: boolean = false,
): Promise<void> {
  return interactionReplyError(
    interaction,
    t("generic.error.error", { ns: "commands" }),
    message,
    ephemeral,
  );
}

export async function interactionReplyErrorInternal(
  interaction: ReplyableInteraction,
): Promise<void> {
  return interactionReplyError(
    interaction,
    t("generic.error.error", { ns: "commands" }),
    t("generic.error.internal", { ns: "commands" }),
  );
}
