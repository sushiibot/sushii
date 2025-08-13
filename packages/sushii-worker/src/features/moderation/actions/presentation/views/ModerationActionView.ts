import type { InteractionEditReplyOptions, User } from "discord.js";
import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from "discord.js";
import type { Result } from "ts-results";

import type { ModerationAction } from "@/features/moderation/shared/domain/entities/ModerationAction";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import type { ModerationTarget } from "@/features/moderation/shared/domain/entities/ModerationTarget";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import {
  formatActionTypeAsPastTense,
  formatActionTypeAsSentence,
  getActionTypeColor,
  getActionTypeEmoji,
} from "@/features/moderation/shared/presentation/views/ActionTypeFormatter";
import type { GuildConfig } from "@/shared/domain/entities/GuildConfig";
import Color from "@/utils/colors";
import { getCleanFilename } from "@/utils/url";

interface ActionResult {
  target: ModerationTarget;
  result: Result<ModerationCase, string>;
}

/**
 * Determines if DMs were intended to be sent based on executor choice and guild settings.
 */
function wereDMsIntended(
  action: ModerationAction | undefined,
  actionType: ActionType,
  guildConfig: GuildConfig,
): boolean {
  // If executor explicitly chose no_dm, DMs were not intended
  if (action?.dmChoice === "no_dm") {
    return false;
  }

  // If executor explicitly chose yes_dm, DMs were intended
  if (action?.dmChoice === "yes_dm") {
    return true;
  }

  // Otherwise check guild settings
  switch (actionType) {
    case ActionType.Ban:
    case ActionType.TempBan:
      return guildConfig.moderationSettings.banDmEnabled;
    case ActionType.Timeout:
    case ActionType.TimeoutAdjust:
      return guildConfig.moderationSettings.timeoutCommandDmEnabled;
    case ActionType.Warn:
      return true; // Warns always DM
    default:
      return false;
  }
}

/**
 * Gets the configured DM message text for the given action type from guild config.
 */
function getConfiguredDMText(
  actionType: ActionType,
  guildConfig: GuildConfig,
): string | null {
  switch (actionType) {
    case ActionType.Warn:
      return guildConfig.moderationSettings.warnDmText;
    case ActionType.Timeout:
    case ActionType.TimeoutAdjust:
      return guildConfig.moderationSettings.timeoutDmText;
    case ActionType.Ban:
    case ActionType.TempBan:
      return guildConfig.moderationSettings.banDmText;
    default:
      return null;
  }
}

export function buildActionResultMessage(
  actionType: ActionType,
  executor: User,
  targets: ModerationTarget[],
  cases: Result<ModerationCase, string>[],
  guildConfig: GuildConfig,
  action?: ModerationAction,
): InteractionEditReplyOptions {
  // Map targets and cases together for cleaner data handling
  const results: ActionResult[] = targets.map((target, index) => ({
    target,
    result: cases[index],
  }));

  const successful = results.filter((r) => r.result.ok);
  const failed = results.filter((r) => !r.result.ok);

  const emoji = getActionTypeEmoji(actionType);
  const actionName = formatActionTypeAsSentence(actionType);

  // Determine title and color based on results
  let title: string;
  let color: number;

  if (successful.length > 0 && failed.length === 0) {
    title = `${emoji} ${actionName} Successful`;
    color = getActionTypeColor(actionType) || Color.Success;
  } else if (successful.length === 0 && failed.length > 0) {
    title = `${emoji} ${actionName} Failed`;
    color = Color.Error;
  } else {
    title = `${emoji} ${actionName} Partial Success`;
    color = Color.Warning;
  }

  // Create container with accent color
  const container = new ContainerBuilder().setAccentColor(color);

  // Build header and user list
  const summary = `${results.length} ${results.length === 1 ? "user" : "users"} processed`;
  let fullContent = `### ${title}\n**${summary}**\n`;

  // Format users in order with failure indicators
  for (const result of results) {
    const failureIcon = !result.result.ok ? "❌ " : "";
    fullContent += `> ${failureIcon}<@${result.target.id}> — \`${result.target.user.username}\` — \`${result.target.id}\`\n`;

    if (!result.result.ok) {
      fullContent += `> -# Error: ${result.result.val}\n`;
    } else {
      // Add DM failure indicator for successful moderation cases
      const moderationCase = result.result.val as ModerationCase;
      if (moderationCase.dmFailed) {
        fullContent += `> -# \\↪ 📭 DM Failed (privacy settings or bot blocked)\n`;
      }
    }
  }

  if (successful.length > 0) {
    const firstSuccessfulCase = successful[0].result.val as ModerationCase;

    // Add reason if available
    if (firstSuccessfulCase.reason) {
      fullContent += `### 📝 Reason`;
      fullContent += `\n> ${firstSuccessfulCase.reason.value}\n`;
    }

    // Add DM status
    const successfulCases = successful.map(
      (s) => s.result.val as ModerationCase,
    );
    const dmAttemptedCount = successfulCases.filter(
      (c) => c.dmAttempted,
    ).length;
    const dmSuccessCount = successfulCases.filter((c) => c.dmSuccess).length;
    const dmFailedCount = successfulCases.filter((c) => c.dmFailed).length;

    // ------------------------------------------------------------------------
    // Additional DM message if configured

    // Only show the configured DM message if DMs were actually attempted
    const configuredDMText = getConfiguredDMText(actionType, guildConfig);
    if (configuredDMText && dmAttemptedCount > 0) {
      fullContent += `### 📋 Additional DM Message\n`;
      fullContent += `> ${configuredDMText}\n`;
      fullContent += "-# As configured in `/settings`\n";
    }

    // Add timeout duration if this is a timeout action
    if (
      (actionType === ActionType.Timeout ||
        actionType === ActionType.TimeoutAdjust) &&
      action?.isTimeoutAction &&
      action.isTimeoutAction()
    ) {
      fullContent += `### ⏱️ Timeout Duration`;
      fullContent += ` \n> ${action.duration.originalString}\n`;
    }

    // Add attachments if available
    if (firstSuccessfulCase.attachments.length > 0) {
      fullContent += `### 📎 Attachments\n`;

      fullContent += "> ";
      fullContent += firstSuccessfulCase.attachments
        .map((a) => `[${getCleanFilename(a)}](${a})`)
        .join(", ");

      fullContent += "\n";
    }

    // ------------------------------------------------------------------------
    // DM status
    let dmSectionContent = "";

    // Determine DM status message based on outcomes
    if (dmAttemptedCount === 0) {
      // No DM attempts were made
      const dmsIntended = wereDMsIntended(action, actionType, guildConfig);
      const usersInGuild = successful.filter((r) => r.target.isInGuild).length;
      const usersNotInGuild = successful.filter(
        (r) => !r.target.isInGuild,
      ).length;

      // Determine the reason for not sending DMs
      if (!dmsIntended) {
        // DMs were intentionally not sent (executor choice or guild settings)
        dmSectionContent += `➖ **Not sent**`;
      } else if (usersNotInGuild > 0 && usersInGuild === 0) {
        // All users are not in server
        dmSectionContent += `➖ **Not sent** — ${usersNotInGuild === 1 ? "User" : "Users"} not in server`;
      } else if (usersNotInGuild > 0 && usersInGuild > 0) {
        // Mixed: some in server, some not (this shouldn't happen in practice since DMs would be attempted for those in server)
        dmSectionContent += `➖ **Not sent** — ${usersNotInGuild} of ${successful.length} users not in server`;
      } else {
        // All users are in server but no DMs sent (shouldn't happen if dmsIntended is true)
        dmSectionContent += `➖ **Not sent**`;
      }
    } else if (dmSuccessCount === dmAttemptedCount) {
      // All attempted DMs sent successfully
      dmSectionContent += `✅ **Sent successfully** — Delivered to ${dmAttemptedCount === 1 ? "user" : `all ${dmAttemptedCount} users`}`;
    } else if (dmSuccessCount === 0) {
      // All DM attempts failed - check failure reasons
      const failureReasons = successfulCases
        .filter((c) => c.dmFailureReason)
        .map((c) => c.dmFailureReason);

      const allUserCannotReceive = failureReasons.every(
        (r) => r === "user_cannot_receive",
      );

      if (allUserCannotReceive) {
        dmSectionContent += `❌ **Failed to send** — Could not deliver to any users (privacy settings or bot blocked)`;
      } else {
        dmSectionContent += `❌ **Failed to send**`;
      }
    } else {
      // Mixed results - some succeeded, some failed
      dmSectionContent += `⚠️ **Partially sent** — Delivered to ${dmSuccessCount} of ${dmAttemptedCount} users`;
      dmSectionContent += `\n> ❌ Could not deliver to ${dmFailedCount} ${dmFailedCount === 1 ? "user" : "users"} (privacy settings or bot blocked)`;
    }

    // Don't show User DMs section for Note actions as they are private
    if (actionType !== ActionType.Note) {
      fullContent += `### 📨 DM Notifications\n`;
      fullContent += dmSectionContent;
    }
  }

  // Add all text content in a single TextDisplayBuilder
  const text = new TextDisplayBuilder().setContent(fullContent);
  container.addTextDisplayComponents(text);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}
