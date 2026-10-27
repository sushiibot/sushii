import type { APIContainerComponent, APIMessage } from "discord-api-types/v10";
import type { ButtonInteraction } from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
  TextDisplayBuilder,
} from "discord.js";
import type { Logger } from "pino";

import { rebuildModerationActionRow } from "@/features/automod/utils/alertComponentUtils";
import type { ModerationService } from "@/features/moderation/actions/application/ModerationService";
import {
  BanAction,
  KickAction,
  SoftbanAction,
  UnbanAction,
  WarnAction,
} from "@/features/moderation/shared/domain/entities/ModerationAction";
import { ModerationTarget } from "@/features/moderation/shared/domain/entities/ModerationTarget";
import customIds from "@/interactions/customIds";
import { ButtonHandler } from "@/shared/presentation/handlers";
import { requireMemberPermission } from "@/shared/presentation/requireMemberPermission";

import {
  buildModerationActionModal,
  buildModerationErrorReply,
  parseModalDeleteSeconds,
  parseModalReason,
} from "./moderationActionModal";

// Mirrors the default permissions of the equivalent slash commands.
const REQUIRED_PERMISSIONS = {
  warn: { flag: PermissionFlagsBits.BanMembers, name: "Ban Members" },
  kick: { flag: PermissionFlagsBits.KickMembers, name: "Kick Members" },
  ban: { flag: PermissionFlagsBits.BanMembers, name: "Ban Members" },
  softban: { flag: PermissionFlagsBits.BanMembers, name: "Ban Members" },
  unban: { flag: PermissionFlagsBits.BanMembers, name: "Ban Members" },
} as const;

const ACTION_VERBS = {
  warn: "warned",
  kick: "kicked",
  ban: "banned",
  softban: "softbanned",
  unban: "unbanned",
} as const;

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

    const params = customIds.automodAlertAction.matchParams(
      interaction.customId,
    );
    if (!params) {
      throw new Error("No automod alert action match");
    }

    const { actionType, userId } = params;

    const required = REQUIRED_PERMISSIONS[actionType];
    if (
      !(await requireMemberPermission(
        interaction,
        required.flag,
        required.name,
      ))
    ) {
      return;
    }

    await interaction.showModal(
      buildModerationActionModal(actionType, interaction.customId),
    );

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

    // defer: fetches the member/user, then runs the moderation action (DM, action REST call, mod log)
    await modalSubmission.deferUpdate();

    const reasonResult = parseModalReason(modalSubmission.fields);
    if (reasonResult.err) {
      await modalSubmission.followUp(
        buildModerationErrorReply(reasonResult.val),
      );
      return;
    }
    const reason = reasonResult.val;

    const deleteMessageSeconds =
      actionType === "ban" || actionType === "softban"
        ? parseModalDeleteSeconds(modalSubmission.fields)
        : 0;

    // Fetch target — member may be null if user left the guild (still valid for ban/unban)
    let member;
    try {
      member = await interaction.guild.members.fetch(userId);
    } catch {
      member = null;
    }

    let targetUser;
    try {
      targetUser =
        member?.user ?? (await interaction.client.users.fetch(userId));
    } catch {
      await modalSubmission.followUp(
        buildModerationErrorReply("Could not find the target user."),
      );
      return;
    }

    const executor = interaction.user;
    const executorMember = interaction.member;
    const guildId = interaction.guildId;

    let action;
    switch (actionType) {
      case "warn":
        action = new WarnAction(
          guildId,
          executor,
          executorMember,
          reason,
          "unspecified",
        );
        break;
      case "kick":
        action = new KickAction(
          guildId,
          executor,
          executorMember,
          reason,
          "unspecified",
        );
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
        action = new UnbanAction(
          guildId,
          executor,
          executorMember,
          reason,
          "unspecified",
        );
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
      await modalSubmission.followUp(
        buildModerationErrorReply(
          `Action failed: ${result?.val ?? "unknown error"}`,
        ),
      );
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
    const caseRef = moderationCase.caseId
      ? ` (case #${moderationCase.caseId})`
      : "";
    const reasonSuffix = reason ? ` · ${reason.value}` : "";
    const actionLine = `-# ${executor.toString()} ${ACTION_VERBS[actionType]} ${targetUser.toString()}${reasonSuffix}${caseRef}`;

    // Rebuild the container: keep existing content, append action result, swap buttons
    if (!modalSubmission.isFromMessage()) {
      return;
    }

    const rawMessage = modalSubmission.message.toJSON() as APIMessage;
    const rawContainer = (rawMessage.components ??
      [])[0] as APIContainerComponent;

    const newActionRow = buildContextualActionRow(actionType, userId);

    const updatedContainer = rebuildModerationActionRow(
      rawContainer,
      new TextDisplayBuilder().setContent(actionLine).toJSON(),
      newActionRow ? newActionRow.toJSON() : null,
    );

    await modalSubmission.editReply({
      components: [updatedContainer],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });
  }
}
