import type { InteractionReplyOptions } from "discord.js";
import {
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} from "discord.js";
import Color from "@/utils/colors";
import { quoteMarkdownString } from "@/utils/markdown";

import type { ChannelContext, MessageVerificationRecord } from "../../application/types";
import { isVerificationRefreshed } from "../../application/types";

function formatChannelContext(
  channelContext: ChannelContext | null,
  channelId: string,
): string[] {
  if (!channelContext) {
    return [`**In**: <#${channelId}> (\`${channelId}\`)`];
  }

  if (channelContext.type === "dm") {
    return [`**In**: Direct Message`];
  }

  if (channelContext.type === "group_dm") {
    const name = channelContext.name ? `"${channelContext.name}" ` : "";
    const memberList = channelContext.recipients.map((u) => `\`@${u}\``).join(", ");
    return [
      `**In**: Group DM ${name}(\`${channelId}\`)`,
      `${channelContext.recipients.length} members: ${memberList}`,
    ];
  }

  const channelPart = channelContext.channelName
    ? `#${channelContext.channelName} (\`${channelId}\`)`
    : `\`${channelId}\``;

  return [
    `**In**: **${channelContext.guildName}** (\`${channelContext.guildId}\`)`,
    `${channelContext.memberCount.toLocaleString()} members · ${channelPart}`,
  ];
}

function formatAttachmentList(
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

export function createVerificationLookupMessage(
  record: MessageVerificationRecord,
): InteractionReplyOptions & { flags: number } {
  const container = new ContainerBuilder().setAccentColor(Color.Info);

  const submittedTs = Math.floor(record.createdAt.getTime() / 1000);
  const messageTs = Math.floor(record.messageTimestamp.getTime() / 1000);
  const wasRefreshed = isVerificationRefreshed(record);
  const updatedTs = Math.floor(record.updatedAt.getTime() / 1000);

  const channelText = formatChannelContext(record.channelContext, record.channelId);
  const attachmentsText = formatAttachmentList(record.attachments);

  const rawContent = record.content.trim();
  let contentSection: string;
  if (rawContent.length === 0) {
    contentSection = "*No text content*";
  } else {
    const TRUNCATION_SUFFIX = "… (truncated)";
    const MAX_CONTENT = 1800;
    const truncated =
      rawContent.length > MAX_CONTENT
        ? rawContent.slice(0, MAX_CONTENT - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX
        : rawContent;
    contentSection = quoteMarkdownString(truncated);
  }

  const channelLines = formatChannelContext(record.channelContext, record.channelId);

  const lines = [
    `## Verified Message`,
    `Submitted by <@${record.submitterUserId}> (\`${record.submitterUserId}\`)`,
    "",
    `**Author**: <@${record.authorId}> \`@${record.authorUsername}\` (\`${record.authorId}\`) · <t:${messageTs}:F>`,
    ...channelLines,
    "",
    `**Message**`,
    contentSection,
    "",
    `**Attachments**`,
    attachmentsText,
    "",
    `**Submitted**: <t:${submittedTs}:f>`,
    ...(wasRefreshed ? [`**Updated**: <t:${updatedTs}:f>`] : []),
  ];

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(lines.join("\n")),
  );

  const imageAttachments = record.attachments.filter(
    (a) => a.url && a.contentType?.startsWith("image/"),
  );
  if (imageAttachments.length > 0) {
    const gallery = new MediaGalleryBuilder().addItems(
      ...imageAttachments.map((a) =>
        new MediaGalleryItemBuilder().setURL(a.url!),
      ),
    );
    container.addMediaGalleryComponents(gallery);
  }

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
