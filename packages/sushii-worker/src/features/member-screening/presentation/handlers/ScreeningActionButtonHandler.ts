import type { ButtonInteraction, Guild, GuildMember } from "discord.js";
import {
  DiscordAPIError,
  MessageFlags,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
} from "discord.js";
import type { Logger } from "pino";

import type { ModerationService } from "@/features/moderation/actions/application/ModerationService";
import {
  buildModerationActionModal,
  buildModerationErrorReply,
  parseModalDeleteSeconds,
  parseModalDuration,
  parseModalReason,
} from "@/features/moderation/actions/presentation/components/moderationActionModal";
import {
  BanAction,
  type ModerationAction,
  TimeoutAction,
  UnTimeoutAction,
  UnbanAction,
} from "@/features/moderation/shared/domain/entities/ModerationAction";
import { ModerationTarget } from "@/features/moderation/shared/domain/entities/ModerationTarget";
import customIds, { type ScreeningActionType } from "@/interactions/customIds";
import { ButtonHandler } from "@/shared/presentation/handlers";
import { requireMemberPermission } from "@/shared/presentation/requireMemberPermission";

import type { MemberScreeningService } from "../../application/MemberScreeningService";
import type { ScreeningPostRenderer } from "../../application/ScreeningPostRenderer";
import type { ScreeningMetrics } from "../../domain/ScreeningMetrics";
import type { ScreeningVerdictRepository } from "../../domain/repositories/ScreeningVerdictRepository";
import {
  ACTION_LOOKBACK_DAYS,
  type ScreeningVerdict,
} from "../../domain/types";

const DAY_MS = 24 * 60 * 60 * 1000;

const ACTIONS: Record<
  ScreeningActionType,
  { flag: bigint; permissionName: string; outcomeAction: string }
> = {
  ban: {
    flag: PermissionFlagsBits.BanMembers,
    permissionName: "Ban Members",
    outcomeAction: "banned",
  },
  unban: {
    flag: PermissionFlagsBits.BanMembers,
    permissionName: "Ban Members",
    outcomeAction: "unbanned",
  },
  timeout: {
    flag: PermissionFlagsBits.ModerateMembers,
    permissionName: "Timeout Members",
    outcomeAction: "timed out",
  },
  untimeout: {
    flag: PermissionFlagsBits.ModerateMembers,
    permissionName: "Timeout Members",
    outcomeAction: "timeout removed",
  },
};

async function fetchMember(
  guild: Guild,
  userId: string,
): Promise<GuildMember | null> {
  try {
    return await guild.members.fetch(userId);
  } catch (err) {
    if (
      err instanceof DiscordAPIError &&
      err.code === RESTJSONErrorCodes.UnknownMember
    ) {
      return null;
    }
    throw err;
  }
}

function isScreeningActionType(value: string): value is ScreeningActionType {
  return Object.hasOwn(ACTIONS, value);
}

export class ScreeningActionButtonHandler extends ButtonHandler {
  customIDMatch = customIds.screeningAction.match;

  constructor(
    private readonly moderationService: Pick<
      ModerationService,
      "executeAction"
    >,
    private readonly verdictRepo: ScreeningVerdictRepository,
    private readonly renderer: Pick<ScreeningPostRenderer, "renderPost">,
    private readonly postRefresher: Pick<
      MemberScreeningService,
      "refreshPosts"
    >,
    private readonly metrics: ScreeningMetrics,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handleInteraction(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not a guild interaction");
    }

    const params = customIds.screeningAction.matchParams(interaction.customId);
    if (!params) {
      throw new Error("No screening action match");
    }

    const { actionType } = params;
    if (!isScreeningActionType(actionType)) {
      throw new Error("Unknown screening action type", {
        cause: { actionType },
      });
    }

    const config = ACTIONS[actionType];
    if (
      !(await requireMemberPermission(
        interaction,
        config.flag,
        config.permissionName,
      ))
    ) {
      return;
    }

    const verdictId = Number(params.verdictId);
    if (!Number.isSafeInteger(verdictId) || verdictId <= 0) {
      throw new Error("Invalid screening verdict id", {
        cause: { verdictId: params.verdictId },
      });
    }

    const verdict = await this.verdictRepo.findById(verdictId);
    if (!verdict || verdict.guildId !== interaction.guildId) {
      await interaction.reply({
        content: "This flag no longer exists.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Per-click id so a stale collector from an earlier dismissed modal can't take this submit.
    const modalCustomId = `${interaction.customId}#${interaction.id}`;
    await interaction.showModal(
      buildModerationActionModal(actionType, modalCustomId),
    );

    let modalSubmission;
    try {
      modalSubmission = await interaction.awaitModalSubmit({
        time: 300_000,
        filter: (i) =>
          i.user.id === interaction.user.id && i.customId === modalCustomId,
      });
    } catch {
      // Rejects only on the 5-minute timeout.
      this.logger.debug(
        { verdictId: verdict.id, actionType, executorId: interaction.user.id },
        "Screening action modal timed out",
      );
      return;
    }

    // defer: fetches the member/user, then runs the moderation action (DM, ban/timeout REST call, mod log)
    await modalSubmission.deferUpdate();

    const reasonResult = parseModalReason(modalSubmission.fields);
    if (reasonResult.err) {
      await modalSubmission.followUp(
        buildModerationErrorReply(reasonResult.val),
      );
      return;
    }
    const reason = reasonResult.val;

    const executor = interaction.user;
    const executorMember = interaction.member;
    const guildId = interaction.guildId;

    let action: ModerationAction;
    let outcomeAction = config.outcomeAction;
    switch (actionType) {
      case "ban":
        action = new BanAction(
          guildId,
          executor,
          executorMember,
          reason,
          "unspecified",
          null,
          undefined,
          parseModalDeleteSeconds(modalSubmission.fields),
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
      case "timeout": {
        const durationResult = parseModalDuration(modalSubmission.fields);
        if (durationResult.err) {
          await modalSubmission.followUp(
            buildModerationErrorReply(durationResult.val),
          );
          return;
        }
        action = new TimeoutAction(
          guildId,
          executor,
          executorMember,
          reason,
          "unspecified",
          null,
          durationResult.val,
        );
        outcomeAction = `timed out ${durationResult.val.originalString}`;
        break;
      }
      case "untimeout":
        action = new UnTimeoutAction(
          guildId,
          executor,
          executorMember,
          reason,
          "unspecified",
        );
        break;
    }

    // A member who left can still be banned or unbanned.
    const member = await fetchMember(interaction.guild, verdict.userId);

    let targetUser;
    try {
      targetUser =
        member?.user ?? (await interaction.client.users.fetch(verdict.userId));
    } catch (err) {
      if (
        !(err instanceof DiscordAPIError) ||
        err.code !== RESTJSONErrorCodes.UnknownUser
      ) {
        throw err;
      }

      await modalSubmission.followUp(
        buildModerationErrorReply("Could not find the target user."),
      );
      return;
    }

    const results = await this.moderationService.executeAction(action, [
      new ModerationTarget(targetUser, member),
    ]);

    const result = results[0];
    if (!result || result.err) {
      this.logger.warn(
        {
          actionType,
          verdictId: verdict.id,
          userId: verdict.userId,
          executorId: executor.id,
          guildId,
          err: result?.val,
        },
        "Screening action failed",
      );
      await modalSubmission.followUp(
        buildModerationErrorReply(
          `Action failed: ${result?.val ?? "unknown error"}`,
        ),
      );
      return;
    }

    const postMessageId = interaction.message.id;
    const now = new Date();
    let markedActioned = false;
    let otherPosts: ScreeningVerdict[] = [];

    if (actionType === "ban" || actionType === "timeout") {
      const lookback = now.getTime() - ACTION_LOOKBACK_DAYS * DAY_MS;
      const changed = await this.verdictRepo.setActioned(
        guildId,
        verdict.userId,
        new Date(Math.min(lookback, verdict.createdAt.getTime())),
        executor.id,
        outcomeAction,
        now,
      );
      markedActioned = changed.length > 0;
      otherPosts = changed.filter((v) => v.postMessageId !== postMessageId);

      if (!changed.some((v) => v.postMessageId === postMessageId)) {
        // The clicked post was already resolved (audit log or an earlier action); still credit this moderator.
        await this.verdictRepo.updateOutcomeAction(
          postMessageId,
          outcomeAction,
          executor.id,
          now,
        );
      }
    } else {
      await this.verdictRepo.updateOutcomeAction(
        postMessageId,
        outcomeAction,
        executor.id,
        now,
      );
    }

    const container = await this.renderer.renderPost(postMessageId);
    if (!container) {
      throw new Error("Actioned screening post has no verdict", {
        cause: { postMessageId },
      });
    }

    await modalSubmission.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });

    if (otherPosts.length > 0) {
      await this.postRefresher.refreshPosts(otherPosts);
    }

    if (markedActioned) {
      this.metrics.recordOutcome("actioned", { source: "button" });
    }

    this.logger.info(
      {
        actionType,
        verdictId: verdict.id,
        userId: verdict.userId,
        executorId: executor.id,
        guildId,
        caseId: result.val.caseId,
      },
      "Screening action executed",
    );
  }
}
