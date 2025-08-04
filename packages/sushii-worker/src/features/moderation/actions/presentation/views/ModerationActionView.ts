import { EmbedBuilder, User } from "discord.js";
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

export function buildActionResultEmbed(
  actionType: ActionType,
  executor: User,
  targets: ModerationTarget[],
  cases: Result<ModerationCase, string>[],
): EmbedBuilder {
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
  const description = `${verb} ${successful.length} of ${results.length} users:\n\n${targetList}`;

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

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setTimestamp();

  if (successful.length > 0) {
    const firstSuccessfulCase = successful[0].result.val as ModerationCase;
    embed.addFields({
      name: "Case ID",
      value: firstSuccessfulCase.caseId.toString(),
      inline: true,
    });

    // Add DM status field
    const dmStatuses = successful.map(s => s.result.val as ModerationCase);
    const dmSuccessCount = dmStatuses.filter(c => c.dmSuccess).length;
    const dmFailedCount = dmStatuses.filter(c => c.dmFailed).length;
    const totalDMAttempted = dmSuccessCount + dmFailedCount;

    if (totalDMAttempted > 0) {
      let dmStatusText: string;
      
      if (dmSuccessCount === dmStatuses.length) {
        dmStatusText = "✅ Reason sent to all members in DMs";
      } else if (dmFailedCount === totalDMAttempted) {
        dmStatusText = "❌ Failed to DM reason to users, their privacy settings do not allow me to DM or they have blocked me :(";
      } else if (dmSuccessCount > 0) {
        dmStatusText = `⚠️ Reason sent to ${dmSuccessCount} of ${dmStatuses.length} members in DMs`;
      } else {
        dmStatusText = "ℹ️ No DMs were sent";
      }

      embed.addFields({
        name: "User DM",
        value: dmStatusText,
        inline: false,
      });
    }
  }

  return embed;
}

function formatTargetResults(results: ActionResult[]): string {
  return results
    .map((result) => {
      const baseText = `<@${result.target.id}> - \`${result.target.user.username}\` - \`${result.target.id}\``;
      return result.result.ok ? baseText : `❌ ${baseText}: ${result.result.val}`;
    })
    .join("\n");
}

export function buildDMStatusEmbed(
  moderationCase: ModerationCase,
): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle("DM Status").setTimestamp();

  if (moderationCase.dmSuccess) {
    embed
      .setColor(Color.Success)
      .setDescription("✅ Successfully sent DM to user");
  } else if (moderationCase.dmFailed) {
    embed
      .setColor(Color.Warning)
      .setDescription(
        `⚠️ Failed to send DM: ${moderationCase.dmResult?.error}`,
      );
  } else {
    embed.setColor(Color.Info).setDescription("ℹ️ No DM was sent");
  }

  return embed;
}
