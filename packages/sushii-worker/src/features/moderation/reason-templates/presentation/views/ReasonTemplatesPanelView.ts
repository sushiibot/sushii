import type {
  InteractionReplyOptions,
  InteractionUpdateOptions,
} from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  TimestampStyles,
  time,
  userMention,
} from "discord.js";

import type { BotEmojiNameType, EmojiMap } from "@/features/bot-emojis/domain";
import {
  TEXT_DISPLAY_MAX_LENGTH,
  quoteLines,
} from "@/features/moderation/shared/presentation/reasonFields";
import Color from "@/utils/colors";
import { truncateText } from "@/utils/truncateText";

import type { ReasonTemplatePage } from "../../application/ReasonTemplateService";
import { previewText } from "../../domain/ReasonExpander";
import type { ReasonTemplate } from "../../domain/ReasonTemplate";
import {
  PAGE_INFO_ID,
  buildAddId,
  buildPageId,
  buildTemplateActionId,
} from "../customIds";

export const REASON_TEMPLATES_PANEL_EMOJIS = [
  "reason",
  "message_edit",
  "trash",
] as const satisfies readonly BotEmojiNameType[];

export type PanelEmojis = EmojiMap<typeof REASON_TEMPLATES_PANEL_EMOJIS>;

export type PanelMessage = InteractionReplyOptions & InteractionUpdateOptions;

const ROW_PREVIEW_LENGTH = 140;
const DELETE_PREVIEW_LENGTH = 200;

function panelMessage(container: ContainerBuilder): PanelMessage {
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function usedTimes(count: number): string {
  return `used ${count} ${count === 1 ? "time" : "times"}`;
}

function divider(): SeparatorBuilder {
  return new SeparatorBuilder()
    .setDivider(true)
    .setSpacing(SeparatorSpacingSize.Small);
}

// A bot emoji that hasn't synced yet comes back as "", which setEmoji rejects.
function withButtonEmoji(button: ButtonBuilder, emoji: string): ButtonBuilder {
  return emoji ? button.setEmoji(emoji) : button;
}

export function shortcutCode(shortcut: string): string {
  return `\`!${shortcut}\``;
}

export function buildListMessage(
  list: ReasonTemplatePage,
  emojis: PanelEmojis,
  notice: string | null = null,
): PanelMessage {
  const container = new ContainerBuilder().setAccentColor(Color.Info);

  if (notice) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# ${notice}`),
    );
  }

  container
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## ${emojis.reason} Reason templates\n-# ${plural(list.total, "template")} · shared with all mods · start any reason with \`!shortcut\``,
      ),
    )
    .addSeparatorComponents(divider());

  if (list.items.length === 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "No templates yet.\nAdd one here, or tick **Save as template** when you set a reason. Templates show up in the reason autocomplete and in reason forms.",
      ),
    );
  }

  for (const template of list.items) {
    const head = template.shortcut
      ? `**${shortcutCode(template.shortcut)}** · ${usedTimes(template.useCount)}`
      : `-# no shortcut · ${usedTimes(template.useCount)}`;

    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `${head}\n${previewText(template.content, ROW_PREVIEW_LENGTH)}`,
          ),
        )
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId(
              buildTemplateActionId("manage", template.id, list.page),
            )
            .setLabel("Manage")
            .setStyle(ButtonStyle.Secondary),
        ),
    );
  }

  container.addSeparatorComponents(divider());

  if (list.pages > 1) {
    container.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buildPageId(list.page - 1))
          .setLabel("Previous")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(list.page <= 1),
        new ButtonBuilder()
          .setCustomId(PAGE_INFO_ID)
          .setLabel(`Page ${list.page} of ${list.pages}`)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(buildPageId(list.page + 1))
          .setLabel("Next")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(list.page >= list.pages),
      ),
    );
  }

  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(buildAddId())
        .setLabel("Add template")
        .setStyle(ButtonStyle.Primary),
    ),
  );

  return panelMessage(container);
}

export function buildDetailMessage(
  template: ReasonTemplate,
  page: number,
  emojis: PanelEmojis,
): PanelMessage {
  const shortcutLine = template.shortcut
    ? shortcutCode(template.shortcut)
    : "none. Add one with Edit to type it in reasons.";

  const meta = [
    `Added by ${userMention(template.createdBy)} ${time(template.createdAt, TimestampStyles.RelativeTime)}`,
    usedTimes(template.useCount),
  ];
  if (template.lastUsedAt) {
    meta.push(
      `last used ${time(template.lastUsedAt, TimestampStyles.RelativeTime)}`,
    );
  }

  const container = new ContainerBuilder()
    .setAccentColor(Color.Info)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Template\n**Shortcut:** ${shortcutLine}`,
      ),
      new TextDisplayBuilder().setContent(
        truncateText(`>>> ${template.content}`, TEXT_DISPLAY_MAX_LENGTH),
      ),
      new TextDisplayBuilder().setContent(`-# ${meta.join(" · ")}`),
    )
    .addSeparatorComponents(divider())
    .addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        withButtonEmoji(
          new ButtonBuilder()
            .setCustomId(buildTemplateActionId("edit", template.id, page))
            .setLabel("Edit")
            .setStyle(ButtonStyle.Secondary),
          emojis.message_edit,
        ),
        withButtonEmoji(
          new ButtonBuilder()
            .setCustomId(buildTemplateActionId("delete", template.id, page))
            .setLabel("Delete")
            .setStyle(ButtonStyle.Danger),
          emojis.trash,
        ),
        new ButtonBuilder()
          .setCustomId(buildPageId(page))
          .setLabel("Back")
          .setStyle(ButtonStyle.Secondary),
      ),
    );

  return panelMessage(container);
}

export function buildDeleteConfirmMessage(
  template: ReasonTemplate,
  page: number,
): PanelMessage {
  const title = template.shortcut
    ? `### Delete ${shortcutCode(template.shortcut)}?`
    : "### Delete this template?";
  const footer = template.shortcut
    ? `-# Past cases keep their reason text. ${shortcutCode(template.shortcut)} stops working in new reasons.`
    : "-# Past cases keep their reason text.";

  const container = new ContainerBuilder()
    .setAccentColor(Color.Error)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${title}\n${quoteLines(truncateText(template.content, DELETE_PREVIEW_LENGTH), DELETE_PREVIEW_LENGTH * 2)}\n${footer}`,
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(
            buildTemplateActionId("deleteConfirm", template.id, page),
          )
          .setLabel("Delete")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(buildTemplateActionId("manage", template.id, page))
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary),
      ),
    );

  return panelMessage(container);
}

export function deletedNotice(template: ReasonTemplate | null): string {
  return template?.shortcut
    ? `Deleted ${shortcutCode(template.shortcut)}`
    : "Deleted a template";
}

export function addedNotice(template: ReasonTemplate): string {
  return template.shortcut
    ? `Added ${shortcutCode(template.shortcut)}`
    : "Added a template";
}

export const MISSING_TEMPLATE_NOTICE = "That template was already deleted.";
