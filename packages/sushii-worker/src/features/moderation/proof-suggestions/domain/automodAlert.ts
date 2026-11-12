import type { MessageData } from "@/features/message-log/domain/types/MessageData";

export const AUTOMOD_ALERT_MESSAGE_TYPE = 24;

export interface AutomodAlertDetails {
  ruleName: string;
  /** Absent for alerts that aren't about a message, e.g. profile blocks. */
  blockedInChannelId?: string;
  /** Flagged content; empty when Discord sent none. */
  content: string;
}

const SNOWFLAKE = /^\d{17,20}$/;

/** Reads the stored alert embed: flagged content in the description, `rule_name` and `channel_id` fields. */
export function parseAutomodAlert(
  embeds: MessageData["embeds"],
): AutomodAlertDetails | null {
  for (const embed of embeds ?? []) {
    const fields = embed.fields ?? [];
    const ruleName = fields.find((f) => f.name === "rule_name")?.value.trim();
    if (!ruleName) {
      continue;
    }

    const channelId = fields.find((f) => f.name === "channel_id")?.value.trim();

    return {
      ruleName,
      blockedInChannelId:
        channelId && SNOWFLAKE.test(channelId) ? channelId : undefined,
      content: embed.description ?? "",
    };
  }

  return null;
}
