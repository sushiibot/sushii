import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  InteractionEditReplyOptions,
  InteractionReplyOptions,
  ModalSubmitInteraction,
} from "discord.js";
import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from "discord.js";
import { t } from "i18next";

import Color from "../../utils/colors";

type ReplyableInteraction =
  | ChatInputCommandInteraction
  | ButtonInteraction
  | ModalSubmitInteraction;

function buildErrorContainer(
  title: string,
  description: string,
): ContainerBuilder {
  const container = new ContainerBuilder().setAccentColor(Color.Error);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`❌ **${title}**\n${description}`),
  );
  return container;
}

export function getErrorMessage(
  title: string,
  description: string,
  ephemeral: boolean = false,
): InteractionReplyOptions {
  return {
    components: [buildErrorContainer(title, description)],
    flags:
      MessageFlags.IsComponentsV2 |
      (ephemeral ? MessageFlags.Ephemeral : 0),
    allowedMentions: { parse: [] },
  };
}

export function getErrorMessageEdit(
  title: string,
  description: string,
): InteractionEditReplyOptions {
  return {
    components: [buildErrorContainer(title, description)],
    flags: MessageFlags.IsComponentsV2,
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
