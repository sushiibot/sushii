import type {
  AnySelectMenuInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  ContextMenuCommandInteraction,
  InteractionEditReplyOptions,
  InteractionReplyOptions,
  ModalSubmitInteraction,
} from "discord.js";
import {
  ActionRowBuilder,
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
} from "discord.js";
import type { ButtonBuilder } from "discord.js";
import { t } from "i18next";

import { buildErrorFeedbackButton } from "@/features/feedback/presentation/views/FeedbackButton";

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

export function buildInternalErrorContainer(
  invokerId: string,
  traceId?: string,
): ContainerBuilder {
  const container = new ContainerBuilder().setAccentColor(Color.Error);

  const lines = [
    "❌ **Something went wrong**",
    "Something unexpected happened. Please try again.",
  ];

  if (traceId) {
    lines.push(`**Error ID:** \`${traceId}\``);
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(lines.join("\n")),
    new TextDisplayBuilder().setContent(
      `-# Tell us what you were doing so we can fix it, or [join our support server](${SUPPORT_SERVER_URL}).`,
    ),
  );
  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      buildErrorFeedbackButton(invokerId, traceId),
    ),
  );
  return container;
}

function getInternalErrorMessage(
  invokerId: string,
  traceId?: string,
): InteractionReplyOptions {
  return {
    components: [buildInternalErrorContainer(invokerId, traceId)],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  };
}

function getInternalErrorMessageEdit(
  invokerId: string,
  traceId?: string,
): InteractionEditReplyOptions {
  return {
    components: [buildInternalErrorContainer(invokerId, traceId)],
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
    await interaction.editReply(
      getInternalErrorMessageEdit(interaction.user.id, traceId),
    );
    return;
  }

  if (interaction.replied) {
    await interaction.followUp(
      getInternalErrorMessage(interaction.user.id, traceId),
    );
    return;
  }

  await interaction.reply(
    getInternalErrorMessage(interaction.user.id, traceId),
  );
}
