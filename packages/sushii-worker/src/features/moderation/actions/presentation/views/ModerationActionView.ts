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

  // Build the unified target list
  const targetList = formatTargetResults(results);
  const summary =
    successful.length === results.length
      ? `Successfully ${verb} ${results.length} ${results.length === 1 ? "user" : "users"}`
      : `${verb} ${successful.length} of ${results.length} ${results.length === 1 ? "user" : "users"}`;

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

  // Add title and summary
  const headerText = new TextDisplayBuilder()
    .setContent(`## ${title}\n\n**${summary}**`);
  container.addTextDisplayComponents(headerText);

  // Add target list
  const targetText = new TextDisplayBuilder().setContent(targetList);
  container.addTextDisplayComponents(targetText);

  if (successful.length > 0) {
    const firstSuccessfulCase = successful[0].result.val as ModerationCase;

    // Build metadata fields section
    let metadataContent = "";

    // Add reason if available
    if (firstSuccessfulCase.reason) {
      metadataContent += `### 📝 Reason\n${firstSuccessfulCase.reason.value}\n\n`;
    }

    // Add executor
    metadataContent += `### 👤 Moderator\n${executor}\n\n`;

    // Add DM status
    const dmStatuses = successful.map((s) => s.result.val as ModerationCase);
    const dmSuccessCount = dmStatuses.filter((c) => c.dmSuccess).length;
    const dmFailedCount = dmStatuses.filter((c) => c.dmFailed).length;
    const totalDMAttempted = dmSuccessCount + dmFailedCount;

    let dmStatusText: string;
    let dmStatusTitle: string;

    if (totalDMAttempted === 0) {
      dmStatusTitle = "📬 Direct Message Status";
      dmStatusText = "No DMs were sent to users";
    } else if (dmSuccessCount === dmStatuses.length) {
      dmStatusTitle = "✅ Direct Messages Sent";
      dmStatusText = `Successfully notified all ${dmStatuses.length} ${dmStatuses.length === 1 ? "user" : "users"} via DM`;
    } else if (dmFailedCount === totalDMAttempted) {
      dmStatusTitle = "❌ Direct Messages Failed";
      dmStatusText = `Could not DM ${totalDMAttempted} ${totalDMAttempted === 1 ? "user" : "users"} (privacy settings or bot blocked)`;
    } else {
      dmStatusTitle = "⚠️ Direct Messages Partial";
      dmStatusText = `**Sent:** ${dmSuccessCount} ${dmSuccessCount === 1 ? "user" : "users"}\n**Failed:** ${dmFailedCount} ${dmFailedCount === 1 ? "user" : "users"} (privacy settings or bot blocked)\n**Total:** ${dmStatuses.length} ${dmStatuses.length === 1 ? "user" : "users"}`;
    }

    metadataContent += `### ${dmStatusTitle}\n${dmStatusText}`;

    const metadataText = new TextDisplayBuilder().setContent(metadataContent);
    container.addTextDisplayComponents(metadataText);
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

function formatTargetResults(results: ActionResult[]): string {
  if (results.length === 0) {
    return "No users targeted";
  }

  if (results.length === 1) {
    const result = results[0];
    const status = result.result.ok ? "✅" : "❌";
    const errorMsg = !result.result.ok
      ? `\n> **Error:** ${result.result.val}`
      : "";

    return `${status} <@${result.target.id}> (\`${result.target.user.username}\`)${errorMsg}`;
  }

  // Group by success/failure for multiple users
  const successful = results.filter((r) => r.result.ok);
  const failed = results.filter((r) => !r.result.ok);

  let output = "";

  if (successful.length > 0) {
    output += "**✅ Successful:**\n";
    output += successful
      .map((r) => `• <@${r.target.id}> (\`${r.target.user.username}\`)`)
      .join("\n");
  }

  if (failed.length > 0) {
    if (output) {
      output += "\n\n";
    }

    output += "**❌ Failed:**\n";
    output += failed
      .map((r) => `• <@${r.target.id}> - ${r.result.val}`)
      .join("\n");
  }

  return output;
}

export function buildDMStatusMessage(
  moderationCase: ModerationCase,
): InteractionEditReplyOptions {
  let color: number;
  let content: string;

  if (moderationCase.dmSuccess) {
    color = Color.Success;
    content = "## DM Status\n\n✅ Successfully sent DM to user";
  } else if (moderationCase.dmFailed) {
    color = Color.Warning;
    content = `## DM Status\n\n⚠️ Failed to send DM: ${moderationCase.dmResult?.error}`;
  } else {
    color = Color.Info;
    content = "## DM Status\n\nℹ️ No DM was sent";
  }

  const container = new ContainerBuilder().setAccentColor(color);
  const text = new TextDisplayBuilder().setContent(content);
  container.addTextDisplayComponents(text);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}
