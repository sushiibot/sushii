import type { APIContainerComponent, APIMessage } from "discord-api-types/v10";
import type {
  ButtonInteraction,
  Message,
  ModalSubmitInteraction,
} from "discord.js";
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
import { Reason } from "@/features/moderation/shared/domain/value-objects/Reason";
import customIds from "@/interactions/customIds";
import { ButtonHandler } from "@/shared/presentation/handlers";
import { requireMemberPermission } from "@/shared/presentation/requireMemberPermission";

import {
  buildModerationErrorReply,
  parseModalDeleteSeconds,
} from "./moderationActionModal";
import {
  type ActionReasonFormDeps,
  type FieldValues,
  ReasonFormRetryStore,
  buildRetryMatcher,
  completeReasonForm,
  retryRefusedReply,
  runActionReasonForm,
} from "./reasonFormSubmit";

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

type AutomodAlertActionType = keyof typeof REQUIRED_PERMISSIONS;

interface AlertContext {
  actionType: AutomodAlertActionType;
  userId: string;
  channelId: string;
  messageId: string;
}

const retryIds = buildRetryMatcher("automodAlert/retry");

export class AutomodAlertActionButtonHandler extends ButtonHandler {
  customIDMatch = (customId: string) => {
    const token = retryIds.parse(customId);
    if (token) {
      return { path: customId, index: 0, params: { token } };
    }
    return customIds.automodAlertAction.match(customId);
  };

  private readonly retries = new ReasonFormRetryStore<{
    context: AlertContext;
    values: FieldValues;
  }>();

  constructor(
    private readonly moderationService: Pick<
      ModerationService,
      "executeAction"
    >,
    private readonly formDeps: ActionReasonFormDeps,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handleInteraction(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not a guild interaction");
    }

    const token = retryIds.parse(interaction.customId);
    if (token) {
      const retry = this.retries.claim(token, interaction.user.id);
      if (retry === "expired" || retry === "wrong_user") {
        await interaction.reply(retryRefusedReply(retry));
        return;
      }

      await this.run(interaction, retry.context, {
        token,
        values: retry.values,
      });
      return;
    }

    const params = customIds.automodAlertAction.matchParams(
      interaction.customId,
    );
    if (!params) {
      throw new Error("No automod alert action match");
    }

    await this.run(interaction, {
      actionType: params.actionType,
      userId: params.userId,
      channelId: interaction.channelId,
      messageId: interaction.message.id,
    });
  }

  private async run(
    interaction: ButtonInteraction<"cached">,
    context: AlertContext,
    retry?: { token: string; values: FieldValues },
  ): Promise<void> {
    const { actionType, userId } = context;

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

    const form = await runActionReasonForm(interaction, this.formDeps, {
      actionType,
      targetId: userId,
      prefill: retry?.values,
      storeRetry: (values) =>
        retryIds.build(
          this.retries.put(interaction.user.id, { context, values }),
        ),
    });
    if (!form) {
      return;
    }

    if (retry) {
      this.retries.delete(retry.token);
    }

    const { submission, parsed, emojis } = form;

    // defer: fetches the member/user, then runs the moderation action (DM, action REST call, mod log)
    await submission.deferUpdate();

    const reason = parsed.text ? Reason.create(parsed.text) : null;
    if (reason?.err) {
      await submission.followUp(
        buildModerationErrorReply(`Invalid reason: ${reason.val}`),
      );
      return;
    }
    const reasonValue = reason?.val ?? null;

    const deleteMessageSeconds =
      actionType === "ban" || actionType === "softban"
        ? parseModalDeleteSeconds(submission.fields)
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
      await submission.followUp(
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
          reasonValue,
          "unspecified",
        );
        break;
      case "kick":
        action = new KickAction(
          guildId,
          executor,
          executorMember,
          reasonValue,
          "unspecified",
        );
        break;
      case "ban":
        action = new BanAction(
          guildId,
          executor,
          executorMember,
          reasonValue,
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
          reasonValue,
          "unspecified",
          deleteMessageSeconds,
        );
        break;
      case "unban":
        action = new UnbanAction(
          guildId,
          executor,
          executorMember,
          reasonValue,
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
      await submission.followUp(
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
    const reasonSuffix = reasonValue ? ` · ${reasonValue.value}` : "";
    const actionLine = `-# ${executor.toString()} ${ACTION_VERBS[actionType]} ${targetUser.toString()}${reasonSuffix}${caseRef}`;

    await completeReasonForm(submission, this.formDeps, {
      guildId,
      userId: executor.id,
      parsed,
      emojis,
    });

    try {
      await this.updateAlert(submission, context, actionLine, Boolean(retry));
    } catch (err) {
      // The action already happened; a stale alert is only cosmetic.
      this.logger.warn(
        { err, guildId, caseId: moderationCase.caseId },
        "Failed to update the automod alert after the action",
      );
    }
  }

  /** A Try again form was opened from the ephemeral error, so the alert is edited over REST. */
  private async updateAlert(
    submission: ModalSubmitInteraction<"cached">,
    context: AlertContext,
    actionLine: string,
    fromRetry: boolean,
  ): Promise<void> {
    let alert: Message | null;
    if (!fromRetry) {
      alert = submission.isFromMessage() ? submission.message : null;
    } else {
      const channel = await submission.client.channels.fetch(context.channelId);
      alert = channel?.isTextBased()
        ? await channel.messages.fetch(context.messageId)
        : null;
    }
    if (!alert) {
      return;
    }

    // Rebuild the container: keep existing content, append action result, swap buttons
    const rawMessage = alert.toJSON() as APIMessage;
    const rawContainer = (rawMessage.components ??
      [])[0] as APIContainerComponent;

    const newActionRow = buildContextualActionRow(
      context.actionType,
      context.userId,
    );

    const updatedContainer = rebuildModerationActionRow(
      rawContainer,
      new TextDisplayBuilder().setContent(actionLine).toJSON(),
      newActionRow ? newActionRow.toJSON() : null,
    );

    const payload = {
      components: [updatedContainer],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    } as const;

    if (fromRetry) {
      await alert.edit(payload);
      await submission.deleteReply();
    } else {
      await submission.editReply(payload);
    }
  }
}
