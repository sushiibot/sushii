import type {
  AnySelectMenuInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  ContextMenuCommandInteraction,
  InteractionEditReplyOptions,
  InteractionReplyOptions,
  ModalSubmitInteraction,
} from "discord.js";
import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from "discord.js";
import { t } from "i18next";

import Color from "../../utils/colors";

const SUPPORT_SERVER_URL = "https://discord.gg/PjDRRXSSAF";

export type ReplyableInteraction =
  | ChatInputCommandInteraction
  | ContextMenuCommandInteraction
  | ButtonInteraction
  | AnySelectMenuInteraction
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

function buildInternalErrorContainer(traceId?: string): ContainerBuilder {
  const container = new ContainerBuilder().setAccentColor(Color.Error);

  const lines = [
    "❌ **Something went wrong**",
    "Something unexpected happened. Please try again.",
  ];

  if (traceId) {
    lines.push(`**Error ID:** \`${traceId}\``);
    lines.push(
      `If this keeps happening, [join our support server](${SUPPORT_SERVER_URL}) and share the error ID.`,
    );
  } else {
    lines.push(
      `If this keeps happening, [join our support server](${SUPPORT_SERVER_URL}).`,
    );
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(lines.join("\n")),
  );
  return container;
}

function getInternalErrorMessage(traceId?: string): InteractionReplyOptions {
  return {
    components: [buildInternalErrorContainer(traceId)],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  };
}

function getInternalErrorMessageEdit(
  traceId?: string,
): InteractionEditReplyOptions {
  return {
    components: [buildInternalErrorContainer(traceId)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
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
  traceId?: string,
): Promise<void> {
  if (interaction.deferred) {
    await interaction.editReply(getInternalErrorMessageEdit(traceId));
    return;
  }

  if (interaction.replied) {
    await interaction.followUp(getInternalErrorMessage(traceId));
    return;
  }

  await interaction.reply(getInternalErrorMessage(traceId));
}
