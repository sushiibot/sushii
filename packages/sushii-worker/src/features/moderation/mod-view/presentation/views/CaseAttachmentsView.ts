import {
  ActionRowBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  escapeMarkdown,
} from "discord.js";

import type { EmojiMap } from "@/features/bot-emojis";
import {
  type HISTORY_ACTION_EMOJIS,
  caseAttachments,
} from "@/features/moderation/cases/presentation/views/HistoryView";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import {
  getActionTypeColor,
  formatActionTypeAsSentence,
  getActionTypeBotEmoji,
} from "@/features/moderation/shared/presentation/views/ActionTypeFormatter";
import { splitCaseAttachments } from "@/features/moderation/shared/presentation/caseMedia";
import dayjs from "@/shared/domain/dayjs";
import { countWithNoun } from "@/shared/presentation/pluralize";
import Color from "@/utils/colors";
import { truncateText } from "@/utils/truncateText";
import { getCleanFilename } from "@/utils/url";

import { MODVIEW_CUSTOM_IDS } from "../customIds";

const SELECT_MAX_OPTIONS = 25;
const SELECT_TEXT_MAX_LENGTH = 100;

/** Picks a case on the current page whose attachments to open; null when none have any. */
export function buildAttachmentSelect(
  pageCases: readonly ModerationCase[],
  disabled: boolean,
): ActionRowBuilder<StringSelectMenuBuilder> | null {
  const withAttachments = pageCases
    .filter((c) => caseAttachments(c).length > 0)
    .slice(0, SELECT_MAX_OPTIONS);
  if (withAttachments.length === 0) {
    return null;
  }

  const options = withAttachments.map((c) =>
    new StringSelectMenuOptionBuilder()
      .setValue(c.caseId)
      .setLabel(
        truncateText(
          `Case #${c.caseId} · ${formatActionTypeAsSentence(c.actionType)}`,
          SELECT_TEXT_MAX_LENGTH,
        ),
      )
      .setDescription(
        truncateText(
          c.reason?.value.replace(/\s+/g, " ") ??
            countWithNoun(caseAttachments(c).length, "attachment"),
          SELECT_TEXT_MAX_LENGTH,
        ),
      ),
  );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(MODVIEW_CUSTOM_IDS.historyAttachments)
      .setPlaceholder("View attachments…")
      .setDisabled(disabled)
      .addOptions(options),
  );
}

/** Private reply showing one case's attachments, media in a gallery so Discord keeps the links fresh. */
export function buildCaseAttachmentsMessage(
  moderationCase: ModerationCase,
  emojis: EmojiMap<typeof HISTORY_ACTION_EMOJIS>,
) {
  const { media, links } = splitCaseAttachments(
    caseAttachments(moderationCase),
  );
  const emoji = emojis[getActionTypeBotEmoji(moderationCase.actionType)];
  const timestamp = dayjs.utc(moderationCase.actionTime).unix();

  const container = new ContainerBuilder()
    .setAccentColor(getActionTypeColor(moderationCase.actionType) ?? Color.Info)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${emoji} Case #${moderationCase.caseId} · ${formatActionTypeAsSentence(moderationCase.actionType)}\n-# <@${moderationCase.userId}> · <t:${timestamp}:f>`,
      ),
    );

  if (media.length > 0) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        media.map((url) => new MediaGalleryItemBuilder().setURL(url)),
      ),
    );
  }

  if (links.length > 0) {
    const fileLinks = links
      .map(
        (url) => `[${escapeMarkdown(getCleanFilename(url) || "file")}](${url})`,
      )
      .join(", ");
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${emojis.attachment} ${truncateText(fileLinks, 3500)}`,
      ),
    );
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  } as const;
}
