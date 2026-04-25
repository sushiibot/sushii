import type { APIContainerComponent, APIMessage } from "discord-api-types/v10";
import { ComponentType } from "discord-api-types/v10";
import type { ButtonInteraction } from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

import Color from "@/utils/colors";
import type { Logger } from "pino";

import type { ModerationService } from "@/features/moderation/actions/application/ModerationService";
import {
  BanAction,
  KickAction,
  SoftbanAction,
  UnbanAction,
  WarnAction,
} from "@/features/moderation/shared/domain/entities/ModerationAction";
import { ModerationTarget } from "@/features/moderation/shared/domain/entities/ModerationTarget";
import { Reason } from "@/features/moderation/shared/domain/value-objects/Reason";
import customIds from "@/interactions/customIds";
import { ButtonHandler } from "@/shared/presentation/handlers";

const DELETE_SECONDS_CUSTOM_ID = "delete_seconds";
const REASON_CUSTOM_ID = "reason";

const MODAL_TITLES = {
  warn: "Warn User",
  kick: "Kick User",
  ban: "Ban User",
  softban: "Softban User",
  unban: "Unban User",
} as const;

const ACTION_VERBS = {
  warn: "warned",
  kick: "kicked",
  ban: "banned",
  softban: "softbanned",
  unban: "unbanned",
} as const;

function buildErrorReply(message: string): {
  components: ReturnType<ContainerBuilder["toJSON"]>[];
  flags: number;
  ephemeral: boolean;
} {
  const container = new ContainerBuilder()
    .setAccentColor(Color.Error)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(message),
    );
  return {
    components: [container.toJSON()],
    flags: MessageFlags.IsComponentsV2,
    ephemeral: true,
  };
}

function buildReasonInput(): TextInputBuilder {
  return new TextInputBuilder()
    .setCustomId(REASON_CUSTOM_ID)
    .setLabel("Reason")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false);
}

function buildModal(
  actionType: "warn" | "kick" | "ban" | "softban" | "unban",
  customId: string,
): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle(MODAL_TITLES[actionType]);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(buildReasonInput()),
  );

  if (actionType === "ban" || actionType === "softban") {
    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel("Delete message history")
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId(DELETE_SECONDS_CUSTOM_ID)
            .setPlaceholder("Previous hour")
            .addOptions([
              { label: "Previous hour", value: "3600", default: true },
              { label: "Don't delete any", value: "0" },
              { label: "Previous 12 hours", value: "43200" },
              { label: "Previous 24 hours", value: "86400" },
              { label: "Previous 3 days", value: "259200" },
              { label: "Previous 7 days", value: "604800" },
            ]),
        ),
    );
  }

  return modal;
}

function buildContextualActionRow(
  actionType: "warn" | "kick" | "ban" | "softban" | "unban",
  userId: string,
): ActionRowBuilder<ButtonBuilder> | null {
  const makeButton = (
    type: "warn" | "kick" | "ban" | "softban" | "unban",
    label: string,
  ): ButtonBuilder =>
    new ButtonBuilder()
      .setCustomId(
        customIds.automodAlertAction.compile({ actionType: type, userId }),
      )
      .setLabel(label)
      .setStyle(ButtonStyle.Secondary);

  switch (actionType) {
    case "warn":
      return new ActionRowBuilder<ButtonBuilder>().addComponents(
        makeButton("warn", "Warn"),
        makeButton("kick", "Kick"),
        makeButton("softban", "Softban"),
        makeButton("ban", "Ban"),
      );
    case "kick":
      return new ActionRowBuilder<ButtonBuilder>().addComponents(
        makeButton("softban", "Softban"),
        makeButton("ban", "Ban"),
      );
    case "softban":
      // User is no longer banned after softban — escalate to ban if needed
      return new ActionRowBuilder<ButtonBuilder>().addComponents(
        makeButton("ban", "Ban"),
      );
    case "ban":
      return new ActionRowBuilder<ButtonBuilder>().addComponents(
        makeButton("unban", "Unban"),
      );
    case "unban":
      return new ActionRowBuilder<ButtonBuilder>().addComponents(
        makeButton("warn", "Warn"),
        makeButton("kick", "Kick"),
        makeButton("softban", "Softban"),
        makeButton("ban", "Ban"),
      );
  }
}

export class AutomodAlertActionButtonHandler extends ButtonHandler {
  customIDMatch = customIds.automodAlertAction.match;

  constructor(
    private readonly moderationService: ModerationService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handleInteraction(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not a guild interaction");
    }

    const params = customIds.automodAlertAction.matchParams(interaction.customId);
    if (!params) {
      throw new Error("No automod alert action match");
    }

    const { actionType, userId } = params;

    await interaction.showModal(buildModal(actionType, interaction.customId));

    let modalSubmission;
    try {
      modalSubmission = await interaction.awaitModalSubmit({
        time: 300_000,
        filter: (i) =>
          i.user.id === interaction.user.id &&
          i.customId === interaction.customId,
      });
    } catch {
      this.logger.debug(
        { userId, actionType, executorId: interaction.user.id },
        "Automod alert action modal timed out",
      );
      return;
    }

    await modalSubmission.deferUpdate();

    // Extract reason (optional)
    const reasonText = modalSubmission.fields
      .getTextInputValue(REASON_CUSTOM_ID)
      .trim();
    let reason: Reason | null = null;
    if (reasonText) {
      const reasonResult = Reason.create(reasonText);
      if (reasonResult.err) {
        await modalSubmission.followUp(buildErrorReply(`Invalid reason: ${reasonResult.val}`));
        return;
      }
      reason = reasonResult.val;
    }

    // Extract delete seconds for ban/softban (optional select menu)
    let deleteMessageSeconds = 0;
    if (actionType === "ban" || actionType === "softban") {
      for (const row of modalSubmission.components) {
        if (!("components" in row)) {
          continue;
        }
        for (const component of row.components) {
          if (
            "customId" in component &&
            component.customId === DELETE_SECONDS_CUSTOM_ID &&
            "values" in component &&
            Array.isArray(component.values)
          ) {
            const val = parseInt(component.values[0] as string, 10);
            if (!isNaN(val)) {
              deleteMessageSeconds = val;
            }
          }
        }
      }
    }

    // Fetch target — member may be null if user left the guild (still valid for ban/unban)
    let member;
    try {
      member = await interaction.guild.members.fetch(userId);
    } catch {
      member = null;
    }

    let targetUser;
    try {
      targetUser = member?.user ?? (await interaction.client.users.fetch(userId));
    } catch {
      await modalSubmission.followUp(buildErrorReply("Could not find the target user."));
      return;
    }

    const executor = interaction.user;
    const executorMember = interaction.member;
    const guildId = interaction.guildId;

    let action;
    switch (actionType) {
      case "warn":
        action = new WarnAction(guildId, executor, executorMember, reason, "unspecified");
        break;
      case "kick":
        action = new KickAction(guildId, executor, executorMember, reason, "unspecified");
        break;
      case "ban":
        action = new BanAction(
          guildId,
          executor,
          executorMember,
          reason,
          "unspecified",
          null,
          undefined,
          deleteMessageSeconds,
        );
        break;
      case "softban":
        action = new SoftbanAction(
          guildId,
          executor,
          executorMember,
          reason,
          "unspecified",
          deleteMessageSeconds,
        );
        break;
      case "unban":
        action = new UnbanAction(guildId, executor, executorMember, reason, "unspecified");
        break;
    }

    const results = await this.moderationService.executeAction(action, [
      new ModerationTarget(targetUser, member),
    ]);

    const result = results[0];
    if (!result || result.err) {
      this.logger.warn(
        {
          actionType,
          userId,
          executorId: executor.id,
          guildId,
          err: result?.val,
        },
        "Automod alert action failed",
      );
      await modalSubmission.followUp(buildErrorReply(`Action failed: ${result?.val ?? "unknown error"}`));
      return;
    }

    const moderationCase = result.val;
    this.logger.info(
      {
        actionType,
        userId,
        executorId: executor.id,
        guildId,
        caseId: moderationCase.caseId,
      },
      "Automod alert action executed",
    );

    // Build the action result line appended to the alert
    const caseRef = moderationCase.caseId ? ` (case #${moderationCase.caseId})` : "";
    const reasonSuffix = reason ? ` · ${reason.value}` : "";
    const actionLine = `-# ${executor.toString()} ${ACTION_VERBS[actionType]} ${targetUser.toString()}${reasonSuffix}${caseRef}`;

    // Rebuild the container: keep existing content, append action result, swap buttons
    if (!modalSubmission.isFromMessage()) {
      return;
    }

    const rawMessage = modalSubmission.message.toJSON() as APIMessage;
    const rawContainer = (rawMessage.components ?? [])[0] as APIContainerComponent;

    // Remove the existing ActionRow (type 1) and any previous action TextDisplay
    const childrenWithoutButtons = rawContainer.components.filter(
      (c) => c.type !== ComponentType.ActionRow,
    );

    // The separator before the button area is always present from the initial build.
    // If a prior action was taken, its TextDisplay is the last child — replace it.
    const lastChild = childrenWithoutButtons[childrenWithoutButtons.length - 1];
    const baseChildren =
      lastChild?.type === ComponentType.TextDisplay
        ? childrenWithoutButtons.slice(0, -1)
        : childrenWithoutButtons;

    const newActionRow = buildContextualActionRow(actionType, userId);

    const updatedContainer: APIContainerComponent = {
      ...rawContainer,
      components: [
        ...baseChildren,
        new TextDisplayBuilder().setContent(actionLine).toJSON(),
        ...(newActionRow ? [newActionRow.toJSON()] : []),
      ],
    };

    await modalSubmission.editReply({
      components: [updatedContainer],
      flags: MessageFlags.IsComponentsV2,
    });
  }
}
