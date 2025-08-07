import {
  ContainerBuilder,
  InteractionEditReplyOptions,
  MessageFlags,
  TextDisplayBuilder,
  User,
} from "discord.js";
import { Result } from "ts-results";

import { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import { ModerationTarget } from "@/features/moderation/shared/domain/entities/ModerationTarget";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import {
  formatActionTypeAsPastTense,
  formatActionTypeAsSentence,
  getActionTypeColor,
  getActionTypeEmoji,
} from "@/features/moderation/shared/presentation/views/ActionTypeFormatter";
import Color from "@/utils/colors";

interface ActionResult {
  target: ModerationTarget;
  result: Result<ModerationCase, string>;
}

export function buildActionResultMessage(
  actionType: ActionType,
  executor: User,
  targets: ModerationTarget[],
  cases: Result<ModerationCase, string>[],
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
      fullContent += `### 📝 Reason\n> ${firstSuccessfulCase.reason.value}\n`;
    }

    // Add DM status
    const dmStatuses = successful.map((s) => s.result.val as ModerationCase);
    const dmSuccessCount = dmStatuses.filter((c) => c.dmSuccess).length;
    const dmFailedCount = dmStatuses.filter((c) => c.dmFailed).length;
    const totalDMAttempted = dmSuccessCount + dmFailedCount;

    if (totalDMAttempted > 0) {
      fullContent += "### User DMs\n";

      if (dmSuccessCount === dmStatuses.length) {
        fullContent += `📬 Sent reason to all ${dmStatuses.length === 1 ? "user" : `${dmStatuses.length} users`} via DM`;
      } else if (dmFailedCount === totalDMAttempted) {
        fullContent += `📭 Could not send reason to any users (privacy settings or bot blocked)`;
      } else {
        fullContent += `📭 Sent reason to ${dmSuccessCount} of ${dmStatuses.length} users via DM.`;
        fullContent += `\n**Could not send reason to ${dmFailedCount} users (privacy settings or bot blocked)**`;
      }
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
