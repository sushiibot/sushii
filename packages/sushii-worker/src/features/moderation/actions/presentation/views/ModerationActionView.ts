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

  const verb = formatActionTypeAsPastTense(actionType);
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
  const summary = `Successfully ${verb} ${results.length} ${results.length === 1 ? "user" : "users"}`;
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

    // Add DM status
    const dmStatuses = successful.map((s) => s.result.val as ModerationCase);
    const dmSuccessCount = dmStatuses.filter((c) => c.dmSuccess).length;
    const dmFailedCount = dmStatuses.filter((c) => c.dmFailed).length;
    const totalDMAttempted = dmSuccessCount + dmFailedCount;

    // ------------------------------------------------------------------------
    // Additional DM message if configured

    // Even if no DMs were attempted, show the configured message if it exists
    const configuredDMText = getConfiguredDMText(actionType, guildConfig);
    if (configuredDMText) {
      fullContent += `### 📋 Additional DM Message\n`;
      fullContent += `> ${configuredDMText}\n`;
      fullContent +=
        "-# This is always sent to the user as configured in `/settings`";
    }

    // ------------------------------------------------------------------------
    // DM status
    let dmEmoji = "";
    let dmSectionContent = "";

    if (dmSuccessCount === dmStatuses.length) {
      dmEmoji = "📬";
      dmSectionContent += `Sent reason to ${dmStatuses.length === 1 ? "user" : `all ${dmStatuses.length} users`} via DM`;
    } else if (dmFailedCount === totalDMAttempted) {
      dmEmoji = "📭";
      dmSectionContent += `Could not send reason to any users (privacy settings or bot blocked)`;
    } else {
      dmEmoji = "📭";
      dmSectionContent += `Sent reason to ${dmSuccessCount} of ${dmStatuses.length} users via DM.`;
      dmSectionContent += `\n**Could not send reason to ${dmFailedCount} users (privacy settings or bot blocked)**`;
    }

    // Don't show User DMs section for Note actions as they are private
    if (actionType !== ActionType.Note) {
      fullContent += `### ${dmEmoji} User DMs\n`;
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
