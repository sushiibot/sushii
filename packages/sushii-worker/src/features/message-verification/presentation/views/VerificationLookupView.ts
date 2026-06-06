import type { InteractionReplyOptions } from "discord.js";
import {
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} from "discord.js";
import Color from "@/utils/colors";

import type { MessageVerificationRecord } from "../../application/types";

const MAX_CONTENT_LENGTH = 3000;

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

function truncateContent(content: string): string {
  if (content.length <= MAX_CONTENT_LENGTH) {
    return content;
  }
  return content.slice(0, MAX_CONTENT_LENGTH) + "… (truncated)";
}

export function createVerificationLookupMessage(
  record: MessageVerificationRecord,
): InteractionReplyOptions & { flags: number } {
  const container = new ContainerBuilder().setAccentColor(Color.Info);

  const submittedTs = Math.floor(record.createdAt.getTime() / 1000);
  const messageTs = Math.floor(record.messageTimestamp.getTime() / 1000);

  const content = record.content.trim();
  const displayContent = content.length === 0
    ? "*No text content*"
    : `\`\`\`\n${truncateContent(content)}\n\`\`\``;

  let text = `## Verification Record \`${record.code}\`\n`;
  text += `**Submitter**\n<@${record.submitterUserId}> (${record.submitterUserId})\n\n`;
  text += `**Message Author**\n${record.authorUsername} (${record.authorId})\n\n`;
  text += `**Original Timestamp**\n<t:${messageTs}:F>\n\n`;
  text += `**Channel**\n<#${record.channelId}> (\`${record.channelId}\`)\n\n`;
  text += `**Content**\n${displayContent}\n\n`;
  text += `**Attachments**\n${formatAttachments(record.attachments)}\n\n`;
  text += `**Submitted At**\n<t:${submittedTs}:F>`;

  const wasRefreshed =
    record.updatedAt.getTime() !== record.createdAt.getTime();
  if (wasRefreshed) {
    const updatedTs = Math.floor(record.updatedAt.getTime() / 1000);
    text += `\n\n**Last Refreshed**\n<t:${updatedTs}:F>`;
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(text),
  );

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
