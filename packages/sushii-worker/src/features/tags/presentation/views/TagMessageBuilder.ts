import type { InteractionReplyOptions } from "discord.js";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} from "discord.js";
import { t } from "i18next";

import dayjs from "@/shared/domain/dayjs";
import Color from "@/utils/colors";

import type { BotEmojiNameType, EmojiMap } from "@/features/bot-emojis/domain";

import type { Tag } from "../../domain/entities/Tag";
import { CUSTOM_IDS } from "../TagConstants";

export const TAG_STATUS_EMOJIS = ["success", "fail"] as const satisfies readonly BotEmojiNameType[];

export type TagStatusEmojiMap = EmojiMap<typeof TAG_STATUS_EMOJIS>;

export interface TagUpdateData {
  fields: { name: string; value: string }[];
  files: AttachmentBuilder[];
}

export function createTagInfoMessage(
  tag: Tag,
): InteractionReplyOptions & { flags: MessageFlags.IsComponentsV2 } {
  const tagData = tag.toData();
  const createdTimestamp = Math.floor(dayjs.utc(tagData.created).unix());

  let content = `**${tagData.name}**\n\n`;
  content += `**Content**\n${tagData.content || "No content"}\n\n`;
  content += `**Owner** <@${tagData.ownerId}>\n`;
  content += `**Use Count** ${tagData.useCount}\n\n`;
  content += `-# Created <t:${createdTimestamp}:R>`;

  const container = new ContainerBuilder().setAccentColor(Color.Info);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(content),
  );

  if (tagData.attachment) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(tagData.attachment),
      ),
    );
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

export function createTagAddSuccessContainer(
  tagName: string,
  content: string | null,
  emoji = "✅",
): ContainerBuilder {
  let text = `${emoji} **Tag added** \`${tagName}\``;
  if (content) {
    text += `\n\n${content}`;
  }

  const container = new ContainerBuilder().setAccentColor(Color.Success);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(text),
  );
  return container;
}

export function createTagErrorContainer(
  title: string,
  description: string,
  emoji = "❌",
): ContainerBuilder {
  const container = new ContainerBuilder().setAccentColor(Color.Error);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`${emoji} **${title}**\n${description}`),
  );
  return container;
}

export function createTagNotFoundContainer(
  tagName: string,
  emoji = "❌",
): ContainerBuilder {
  const container = new ContainerBuilder().setAccentColor(Color.Error);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${emoji} **Tag not found**\n${t("tag.get.not_found", { ns: "commands", tagName })}`,
    ),
  );
  return container;
}

export async function processTagAttachment(
  newContent: string | null,
  newAttachment: { url: string; name: string } | null,
): Promise<
  { success: true; data: TagUpdateData } | { success: false; error: string }
> {
  const fields: { name: string; value: string }[] = [];
  const files: AttachmentBuilder[] = [];

  if (newContent) {
    fields.push({
      name: t("tag.edit.success.content", { ns: "commands" }),
      value: newContent,
    });
  }

  if (newAttachment) {
    fields.push({
      name: t("tag.edit.success.attachment", { ns: "commands" }),
      value: newAttachment.url,
    });

    try {
      const file = await fetch(newAttachment.url);
      if (!file.ok) {
        return {
          success: false,
          error: `Failed to fetch attachment (HTTP ${file.status}).`,
        };
      }
      const buf = await file.arrayBuffer();

      const attachment = new AttachmentBuilder(Buffer.from(buf)).setName(
        newAttachment.name,
      );

      files.push(attachment);
    } catch {
      return {
        success: false,
        error: "Failed to fetch attachment from Discord.",
      };
    }
  }

  return { success: true, data: { fields, files } };
}


interface TagEditMessageFlags {
  disabled?: boolean;
  showDeleteConfirmation?: boolean;
  deleted?: boolean;
}

/**
 * Creates a message for editing a tag.
 *
 * @param tag
 * @returns InteractionReplyOptions & { flags: MessageFlags.IsComponentsV2 },
 *          flags limited to MessageFlags.IsComponentsV2 so it can also be used
 *          for InteractionUpdateOptions.
 *
 */
export function createTagEditMessage(
  tag: Tag,
  flags: TagEditMessageFlags = {},
): InteractionReplyOptions & {
  flags: MessageFlags.IsComponentsV2;
} {
  const container = new ContainerBuilder();

  let contentTextContent = "";

  if (flags.deleted) {
    contentTextContent += `### Tag Deleted`;
    contentTextContent += `\nTag details are still shown below in case you want to re-add it.\n\n`;

    container.setAccentColor(Color.Error);
  } else {
    contentTextContent += `### Editing Tag\n`;

    container.setAccentColor(Color.Info);
  }

  contentTextContent += `**Name**
${tag.getName()}

**Content**
${tag.getContent() || "No content provided."}`;

  if (tag.getAttachment()) {
    contentTextContent += `\n\n**Attachment**\n${tag.getAttachment()}`;
  }

  contentTextContent += `\n\n**Tag Owner**
<@${tag.getOwnerId()}>

**Use Count**
${tag.getUseCount()}
`;

  if (flags.disabled) {
    contentTextContent += `\n-# Editing buttons expired, re-run command to edit.`;
  } else if (flags.deleted) {
    contentTextContent += `\n-# Editing buttons disabled as tag was deleted.`;
  } else {
    contentTextContent += `\n-# Editing buttons expires in 2 minutes.`;
  }

  const contentText = new TextDisplayBuilder().setContent(contentTextContent);
  container.addTextDisplayComponents(contentText);

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(CUSTOM_IDS.RENAME)
      .setLabel("Rename")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!!(flags.disabled || flags.deleted)),
    new ButtonBuilder()
      .setCustomId(CUSTOM_IDS.EDIT_CONTENT)
      .setLabel("Edit Content")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!!(flags.disabled || flags.deleted)),
    new ButtonBuilder()
      .setCustomId(CUSTOM_IDS.DELETE)
      .setLabel("Delete")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!!(flags.disabled || flags.deleted)),
  );

  container.addActionRowComponents(actionRow);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: {
      parse: [],
    },
  };
}

export function createTagDeleteConfirmationMessage(
  tagName: string,
): InteractionReplyOptions & {
  flags: MessageFlags.IsComponentsV2;
} {
  const container = new ContainerBuilder();

  const content = `### Confirm Deletion
Are you sure you want to delete the tag \`${tagName}\`? This cannot be undone.`;

  const textBuilder = new TextDisplayBuilder().setContent(content);
  container.addTextDisplayComponents(textBuilder);

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(CUSTOM_IDS.CONFIRM_DELETE)
      .setLabel("Confirm Delete")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(CUSTOM_IDS.CANCEL_DELETE)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary),
  );

  container.addActionRowComponents(actionRow);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: {
      parse: [],
    },
  };
}

export function createTagHelpMessage(
  hasManageGuild: boolean,
): InteractionReplyOptions & {
  flags: MessageFlags.IsComponentsV2;
} {
  const container = new ContainerBuilder().setAccentColor(Color.Info);

  const content = `### Tag Commands Help
Tags are custom server messages that can be saved and used later.

**Using Tags**
\`/t <name>\` - Use a tag

**Browsing Tags**
\`/tag info <name>\` - Get tag information
\`/tag list\` - Show all server tags
\`/tag search\` - Search tags with filters
\`/tag random\` - Get a random tag

**Managing Tags**
\`/tag-add <name>\` - Create a new tag
\`/tag-edit <name>\` - Edit an existing tag

**Admin Commands** - Requires \`Manage Guild\` permission
\`/tag-admin delete <name>\` - Delete a tag
\`/tag-admin delete_user_tags <user>\` - Delete all user's tags`;

  const textDisplay = new TextDisplayBuilder().setContent(content);
  container.addTextDisplayComponents(textDisplay);

  if (hasManageGuild) {
    container.addSeparatorComponents(new SeparatorBuilder());

    const contentFooter = `
**Changing Command Permissions**
In sushii's integration settings, you can set different permissions for each
group of commands. This is also why they're separate commands in case you want
to allow or deny access to specific commands, e.g. allow using tags but not
allow adding tags.

To modify permissions, select a command:
\`Server Settings > Integrations > sushii > Commands > Tag Commands\`

Then optionally set a role or member override to allow or deny access to
specific commands.
`;

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(contentFooter),
    );
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: {
      parse: [],
    },
  };
}
