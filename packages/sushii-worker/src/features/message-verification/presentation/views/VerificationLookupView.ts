import type { InteractionReplyOptions } from "discord.js";
import {
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} from "discord.js";
import Color from "@/utils/colors";

import type { MessageVerificationRecord } from "../../application/types";
import { isVerificationRefreshed } from "../../application/types";

function formatAttachments(
  attachments: MessageVerificationRecord["attachments"],
): string {
  if (attachments.length === 0) {
    return "None";
  }

  return attachments
    .map((a) => {
      const type = a.contentType ?? "unknown";
      const sizeKb = (a.size / 1024).toFixed(1);
      return `• \`${a.filename}\` — ${type} — ${sizeKb} KB`;
    })
    .join("\n");
}

function escapeCodeFence(text: string): string {
  return text.replace(/`{3}/g, "` `` `");
}

export function createVerificationLookupMessage(
  record: MessageVerificationRecord,
): InteractionReplyOptions & { flags: number } {
  const container = new ContainerBuilder().setAccentColor(Color.Info);

  const submittedTs = Math.floor(record.createdAt.getTime() / 1000);
  const messageTs = Math.floor(record.messageTimestamp.getTime() / 1000);
  const wasRefreshed = isVerificationRefreshed(record);

  const attachmentsText = formatAttachments(record.attachments);

  const prefix = [
    `## Verification Record \`${record.code}\`\n`,
    `**Submitter**\n<@${record.submitterUserId}> (${record.submitterUserId})\n\n`,
    `**Message Author**\n${record.authorUsername} (${record.authorId})\n\n`,
    `**Original Timestamp**\n<t:${messageTs}:F>\n\n`,
    `**Channel**\n<#${record.channelId}> (\`${record.channelId}\`)\n\n`,
    `**Content**\n`,
  ].join("");

  const updatedTs = Math.floor(record.updatedAt.getTime() / 1000);

  const suffix = [
    `\n\n**Attachments**\n${attachmentsText}\n\n`,
    `**Submitted At**\n<t:${submittedTs}:F>`,
    wasRefreshed ? `\n\n**Last Refreshed**\n<t:${updatedTs}:F>` : "",
  ].join("");

  const TRUNCATION_SUFFIX = "… (truncated)";
  const FENCE_CHARS = 8;
  const DISCORD_LIMIT = 3950;
  const contentBudget = DISCORD_LIMIT - prefix.length - suffix.length - FENCE_CHARS;

  const rawContent = record.content.trim();
  let displayContent: string;
  if (rawContent.length === 0) {
    displayContent = "*No text content*";
  } else {
    const escaped = escapeCodeFence(rawContent);
    const truncated =
      contentBudget > TRUNCATION_SUFFIX.length && escaped.length > contentBudget
        ? escaped.slice(0, contentBudget - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX
        : escaped;
    displayContent = `\`\`\`\n${truncated}\n\`\`\``;
  }

  const text = prefix + displayContent + suffix;

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `-# Code \`${record.code}\` — verified by sushii`,
    ),
  );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

export function createVerificationNotFoundMessage(): InteractionReplyOptions & {
  flags: number;
} {
  const container = new ContainerBuilder().setAccentColor(Color.Error);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "## Code Not Found\nNo verification record was found for that code. Make sure the code is correct and try again.",
    ),
  );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  };
}

export function createVerificationLookupErrorMessage(): InteractionReplyOptions & {
  flags: number;
} {
  const container = new ContainerBuilder().setAccentColor(Color.Error);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "## Error\nSomething went wrong while looking up the verification record. Please try again later.",
    ),
  );
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  };
}
