import type {
  APIEmbedField,
  InteractionReplyOptions} from "discord.js";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  EmbedBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} from "discord.js";
import { t } from "i18next";

import dayjs from "@/shared/domain/dayjs";
import Color from "@/utils/colors";

import type { Tag } from "../../domain/entities/Tag";
import { CUSTOM_IDS } from "../TagConstants";

export interface TagUpdateData {
  fields: APIEmbedField[];
  files: AttachmentBuilder[];
}

export function createTagInfoEmbed(tag: Tag): EmbedBuilder {
  const tagData = tag.toData();

  return new EmbedBuilder()
    .setTitle(
      t("tag.info.success.title", { ns: "commands", tagName: tagData.name }),
    )
    .setColor(Color.Info)
    .setFields([
      {
        name: t("tag.info.success.content", { ns: "commands" }),
        value: tagData.content || "No content",
      },
      {
        name: t("tag.info.success.attachment", { ns: "commands" }),
        value: tagData.attachment || "No attachment",
      },
      {
        name: t("tag.info.success.owner", { ns: "commands" }),
        value: `<@${tagData.ownerId}>`,
      },
      {
        name: t("tag.info.success.use_count", { ns: "commands" }),
        value: tagData.useCount.toString(),
      },
    ])
    .setImage(tagData.attachment || null)
    .setTimestamp(dayjs.utc(tagData.created).toDate());
}

export function createTagSuccessEmbed(
  title: string,
  fields: APIEmbedField[],
  attachment?: string | null,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setFields(fields)
    .setColor(Color.Success);

  if (attachment) {
    embed.setImage(attachment);
  }

  return embed;
}

export function createTagDeleteSuccessMessage(
  tag: Tag,
): InteractionReplyOptions & {
  flags: MessageFlags.IsComponentsV2;
} {
  const tagData = tag.toData();

  const container = new ContainerBuilder();

  const content = `### Tag Deleted
The tag \`${tagData.name}\` has been successfully deleted.`;
  const text = new TextDisplayBuilder().setContent(content);

  container.addTextDisplayComponents(text);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: {
      parse: [],
    },
  };
}

export function createTagErrorEmbed(
  title: string,
  description: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(Color.Error);
}

export function createTagNotFoundEmbed(tagName: string): EmbedBuilder {
  return new EmbedBuilder()
    .setDescription(t("tag.get.not_found", { ns: "commands", tagName }))
    .setColor(Color.Error);
}

export async function processTagAttachment(
  newContent: string | null,
  newAttachment: { url: string; name: string } | null,
): Promise<
  { success: true; data: TagUpdateData } | { success: false; error: string }
> {
  const fields: APIEmbedField[] = [];
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
  flags: TagEditMessageFlags = {
    disabled: false,
  },
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
      .setDisabled(flags.disabled),
    new ButtonBuilder()
      .setCustomId(CUSTOM_IDS.EDIT_CONTENT)
      .setLabel("Edit Content")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(flags.disabled),
    new ButtonBuilder()
      .setCustomId(CUSTOM_IDS.DELETE)
      .setLabel("Delete")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(flags.disabled),
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

export function createTagEditEmbed(tag: Tag): EmbedBuilder {
  const tagData = tag.toData();

  return new EmbedBuilder()
    .setTitle("Editing Tag - " + tagData.name)
    .setColor(Color.Info)
    .setFields([
      {
        name: "Name",
        value: tagData.name,
      },
      {
        name: "Content",
        value: tagData.content || "No content",
      },
      {
        name: "Attachment",
        value: tagData.attachment || "No attachment",
      },
      {
        name: "Owner",
        value: `<@${tagData.ownerId}>`,
      },
      {
        name: "Use Count",
        value: tagData.useCount.toString(),
      },
    ])
    .setImage(tagData.attachment || null)
    .setTimestamp(dayjs.utc(tagData.created).toDate())
    .setFooter({
      text: "Editing expires in 2 minutes",
    });
}

export function createTagEditActionRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(CUSTOM_IDS.EDIT_CONTENT)
      .setLabel("Edit Content")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(CUSTOM_IDS.RENAME)
      .setLabel("Rename")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(CUSTOM_IDS.DELETE)
      .setLabel("Delete")
      .setStyle(ButtonStyle.Danger),
  );
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
