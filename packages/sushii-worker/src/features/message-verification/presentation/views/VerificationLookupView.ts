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

// Returns a single-line location string — never uses <#id> since it only
// resolves when the viewer is in that specific guild.
function formatLocation(
  channelContext: ChannelContext | null,
  channelId: string,
): string {
  if (!channelContext) {
    return `\`${channelId}\``;
  }

  if (channelContext.type === "dm") {
    return "Direct Message";
  }

  if (channelContext.type === "group_dm") {
    const name = channelContext.name ? `"${channelContext.name}"` : "Group DM";
    const members = channelContext.recipients.map((u) => `\`@${u}\``).join(", ");
    return `${name} · ${members}`;
  }

  const channelPart = channelContext.channelName
    ? `#${channelContext.channelName}`
    : `\`${channelId}\``;

  return `${channelPart} · **${channelContext.guildName}** · ${channelContext.memberCount.toLocaleString()} members`;
}

export function createVerificationLookupMessage(
  record: MessageVerificationRecord,
): InteractionReplyOptions & { flags: number } {
  const container = new ContainerBuilder().setAccentColor(Color.Info);

  const submittedTs = Math.floor(record.createdAt.getTime() / 1000);
  const messageTs = Math.floor(record.messageTimestamp.getTime() / 1000);
  const wasRefreshed = isVerificationRefreshed(record);
  const updatedTs = Math.floor(record.updatedAt.getTime() / 1000);

  const location = formatLocation(record.channelContext, record.channelId);

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

  const imageAttachments = record.attachments.filter(
    (a) => a.url && a.contentType?.startsWith("image/"),
  );

  const nonImageAttachments = record.attachments.filter(
    (a) => !a.contentType?.startsWith("image/"),
  );

  const footerParts = [
    `Submitted by <@${record.submitterUserId}> (\`${record.submitterUserId}\`) · <t:${submittedTs}:f>`,
    ...(wasRefreshed ? [`Updated <t:${updatedTs}:f>`] : []),
    `Code \`${record.code}\` — verified by sushii`,
  ];

  const lines = [
    `## Verified Message`,
    `<@${record.authorId}> (\`${record.authorId}\`) · <t:${messageTs}:F>`,
    location,
    "",
    contentSection,
  ];

  if (nonImageAttachments.length > 0) {
    const attachmentList = nonImageAttachments
      .map((a) => {
        const type = a.contentType ?? "unknown";
        const sizeKb = (a.size / 1024).toFixed(1);
        return `• \`${a.filename}\` — ${type} — ${sizeKb} KB`;
      })
      .join("\n");
    lines.push("", "**Attachments**", attachmentList);
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(lines.join("\n")),
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
      footerParts.map((p) => `-# ${p}`).join("\n"),
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
