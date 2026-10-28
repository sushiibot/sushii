import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
  escapeMarkdown,
} from "discord.js";

import type { BotEmojiNameType, EmojiMap } from "@/features/bot-emojis/domain";
import type { TimeoutChange } from "@/features/moderation/audit-logs/domain/value-objects/TimeoutChange";
import dayjs from "@/shared/domain/dayjs";
import Color from "@/utils/colors";
import { truncateText } from "@/utils/truncateText";
import { getCleanFilename } from "@/utils/url";

import type {
  DMFailureReason,
  ModerationCase,
} from "../../domain/entities/ModerationCase";
import {
  ActionType,
  ActionTypeBotEmojis,
  actionTypeSupportsDM,
} from "../../domain/value-objects/ActionType";
import {
  formatActionTypeAsSentence,
  getActionTypeBotEmoji,
  getActionTypeColor,
} from "./ActionTypeFormatter";
import {
  buildModLogDeleteDmButtonId,
  buildModLogDmConfirmId,
  buildModLogReasonButtonId,
} from "./modLogCustomIds";

export const MOD_LOG_EMOJIS = [
  ...ActionTypeBotEmojis,
  "message",
  "fail",
  "duration",
  "trash",
  "message_edit",
] as const satisfies readonly BotEmojiNameType[];

export type ModLogEmojis = EmojiMap<typeof MOD_LOG_EMOJIS>;

/** Discord's cap on text across all text displays in one message. */
const MESSAGE_TEXT_MAX_LENGTH = 4000;
const MEDIA_GALLERY_MAX_ITEMS = 10;
const LEGACY_DM_DELETED_LABEL = "Reason DM deleted";
const ATTACHMENT_LINKS_MAX_LENGTH = 600;
const MEDIA_EXTENSIONS = /\.(png|jpe?g|gif|webp|avif|mp4|mov|webm)$/i;

export interface ModLogTarget {
  id: string;
  username: string;
  avatarURL: string;
}

export interface ModLogMessageInput {
  moderationCase: ModerationCase;
  target: ModLogTarget;
  emojis: ModLogEmojis;
  /** Only known while handling the audit log event; re-renders use the stored duration. */
  timeoutChange?: TimeoutChange;
  /** Plain-text name for the executor, so the byline reads even if the mention doesn't resolve. */
  executorTag?: string | null;
  /**
   * The facts block of the entry being re-rendered, kept verbatim because
   * some lines (previous timeout end, durations of old cases) aren't stored.
   * Ignored when timeoutChange is given.
   */
  factsBlock?: string | null;
  /** Lines carried over from a legacy embed, added after the computed facts. */
  extraFacts?: readonly string[];
  /** Swaps the button row for the in-place Delete DM confirmation. */
  confirmDeleteDm?: boolean;
  /** Shown as the executor when the case has none, e.g. the bot's own ID. */
  fallbackExecutorId?: string | null;
}

export interface ModLogMessage {
  components: ContainerBuilder[];
  flags: MessageFlags.IsComponentsV2;
  allowedMentions: { parse: [] };
}

/** Stable component id of the facts block, so a re-render can copy it. */
export const MOD_LOG_FACTS_ID = 1001;

/** Old embed fields the database can't rebuild. */
const LEGACY_UNSTORED_FIELDS = ["Previous Timeout", "Removed Timeout"];
const LEGACY_DURATION_FIELDS = ["Timeout Duration", "Ban Duration"];
const LEGACY_FACTS_MAX_LENGTH = 600;

const ACTION_TITLES: Partial<Record<ActionType, string>> = {
  [ActionType.Ban]: "Banned",
  [ActionType.TempBan]: "Temporarily banned",
  [ActionType.BanRemove]: "Unbanned",
  [ActionType.Softban]: "Softbanned",
  [ActionType.Kick]: "Kicked",
  [ActionType.Timeout]: "Timed out",
  [ActionType.TimeoutAdjust]: "Timeout changed",
  [ActionType.TimeoutRemove]: "Timeout removed",
  [ActionType.Warn]: "Warned",
  [ActionType.Note]: "Note",
};

const DM_FAILURE_TEXT: Record<DMFailureReason, string> = {
  user_blocked: "they have DMs off or blocked sushii",
  user_privacy: "they have server DMs off or share no server with sushii",
  user_cannot_receive: "Discord won't deliver DMs to them",
  unknown: "Discord returned an error",
};

function unix(date: Date | dayjs.Dayjs): number {
  return dayjs(date).unix();
}

function withEmoji(emoji: string, text: string): string {
  return emoji ? `${emoji} ${text}` : text;
}

/** "an hour" reads badly after "previous" and as a duration; Discord-style "1 hour" doesn't. */
function humanizeSeconds(seconds: number): string {
  return dayjs.duration(seconds, "seconds").humanize().replace(/^an? /, "1 ");
}

function durationFact(
  moderationCase: ModerationCase,
  timeoutChange: TimeoutChange | undefined,
  emojis: ModLogEmojis,
): string | null {
  const type = moderationCase.actionType;
  const isTimeout =
    type === ActionType.Timeout || type === ActionType.TimeoutAdjust;
  if (type !== ActionType.TempBan && !isTimeout) {
    return null;
  }

  if (isTimeout && timeoutChange?.newTimestamp && timeoutChange.duration) {
    return withEmoji(
      emojis.duration,
      `${humanizeSeconds(timeoutChange.duration.asSeconds())} · ends <t:${unix(timeoutChange.newTimestamp)}:f>`,
    );
  }

  const seconds = moderationCase.timeoutDuration;
  if (seconds == null || seconds <= 0) {
    return null;
  }

  const end = dayjs(moderationCase.actionTime).add(seconds, "seconds");
  return withEmoji(
    emojis.duration,
    `${humanizeSeconds(seconds)} · ends <t:${unix(end)}:f>`,
  );
}

function buildFacts(input: ModLogMessageInput): string[] {
  const { moderationCase, timeoutChange, emojis } = input;
  const type = moderationCase.actionType;
  const facts: string[] = [];

  const duration = durationFact(moderationCase, timeoutChange, emojis);
  if (duration) {
    facts.push(duration);
  }

  if (
    type === ActionType.TimeoutAdjust &&
    timeoutChange?.actionType === ActionType.TimeoutAdjust &&
    timeoutChange.oldTimestamp
  ) {
    facts.push(
      `Previous timeout would have ended <t:${unix(timeoutChange.oldTimestamp)}:R>`,
    );
  }

  if (
    type === ActionType.TimeoutRemove &&
    timeoutChange?.actionType === ActionType.TimeoutRemove &&
    timeoutChange.oldTimestamp
  ) {
    facts.push(
      `Timeout would have ended <t:${unix(timeoutChange.oldTimestamp)}:R>`,
    );
  }

  const deleteSeconds = moderationCase.deleteMessageSeconds;
  const deletesMessages =
    type === ActionType.Ban ||
    type === ActionType.TempBan ||
    type === ActionType.Softban;
  if (deletesMessages && deleteSeconds != null) {
    if (deleteSeconds > 0) {
      facts.push(
        withEmoji(
          emojis.trash,
          `Deleted messages from the previous ${humanizeSeconds(deleteSeconds).replace(/^1 /, "")}`,
        ),
      );
    } else if (type === ActionType.Softban) {
      facts.push("No messages deleted");
    }
  }

  return facts;
}

function dmStatusLine(input: ModLogMessageInput): string | null {
  const { moderationCase, emojis } = input;
  const dm = moderationCase.dmResult;

  if (moderationCase.dmDeleted) {
    const by = moderationCase.dmDeletedBy
      ? ` by <@${moderationCase.dmDeletedBy}>`
      : "";
    const at = moderationCase.dmDeletedAt
      ? ` <t:${unix(moderationCase.dmDeletedAt)}:R>`
      : "";
    return withEmoji(emojis.message, `Reason DM deleted${by}${at}`);
  }

  if (dm?.channelId && dm.messageId) {
    return withEmoji(emojis.message, "Reason DM sent");
  }

  if (dm?.error || moderationCase.dmFailureReason) {
    const reason =
      moderationCase.dmFailureReason ?? dm?.failureReason ?? "unknown";
    return withEmoji(
      emojis.fail,
      `Reason DM failed: ${DM_FAILURE_TEXT[reason]}`,
    );
  }

  if (!actionTypeSupportsDM(moderationCase.actionType)) {
    return null;
  }

  if (moderationCase.dmNotAttemptedReason === "user_not_in_guild") {
    return withEmoji(emojis.message, "No DM sent: they weren't in the server");
  }

  return withEmoji(emojis.message, "No DM sent");
}

export function hasLiveDm(moderationCase: ModerationCase): boolean {
  return (
    !moderationCase.dmDeleted &&
    !!moderationCase.dmResult?.channelId &&
    !!moderationCase.dmResult.messageId
  );
}

export interface PostedMessage {
  flags: { has(flag: MessageFlags): boolean };
  components: readonly { toJSON(): unknown }[];
}

/**
 * Embed entries from before components v2 marked a deleted DM only with a
 * disabled "Reason DM deleted" button; the case row was never updated.
 */
export function isLegacyEntryWithDeletedDm(message: PostedMessage): boolean {
  if (!isLegacyEntry(message)) {
    return false;
  }

  return message.components.some((row) => {
    const json = row.toJSON() as { components?: { label?: string }[] };
    return (json.components ?? []).some(
      (c) => c.label === LEGACY_DM_DELETED_LABEL,
    );
  });
}

function splitAttachments(attachments: string[]): {
  media: string[];
  links: string[];
} {
  const media: string[] = [];
  const links: string[] = [];

  for (const url of attachments.filter(Boolean)) {
    const isMedia =
      /^https?:\/\//.test(url) && MEDIA_EXTENSIONS.test(getCleanFilename(url));
    if (isMedia && media.length < MEDIA_GALLERY_MAX_ITEMS) {
      media.push(url);
    } else {
      links.push(url);
    }
  }

  return { media, links };
}

function attachmentLinks(links: string[]): string {
  const shown: string[] = [];
  let length = 0;
  for (const url of links) {
    const link = `[${escapeMarkdown(getCleanFilename(url) || "file")}](${url})`;
    if (length + link.length > ATTACHMENT_LINKS_MAX_LENGTH) {
      break;
    }
    shown.push(link);
    length += link.length + 2;
  }

  const hidden = links.length - shown.length;
  const more = hidden > 0 ? `${shown.length ? ", " : ""}${hidden} more` : "";
  return `Attachments: ${shown.join(", ")}${more}`;
}

function button(
  label: string,
  customId: string,
  style: ButtonStyle,
  emoji?: string,
): ButtonBuilder {
  const builder = new ButtonBuilder()
    .setLabel(label)
    .setCustomId(customId)
    .setStyle(style);
  if (emoji) {
    builder.setEmoji(emoji);
  }

  return builder;
}

export interface DeleteDmConfirmOptions {
  /** One recipient's name, or how many DMs the action sent. */
  recipient: { name: string } | { count: number };
  confirmCustomId: string;
  cancelCustomId: string;
}

/**
 * The in-place confirmation that replaces a message's button row when a mod
 * clicks Delete DM.
 */
export function buildDeleteDmConfirm(options: DeleteDmConfirmOptions): {
  prompt: TextDisplayBuilder;
  row: ActionRowBuilder<ButtonBuilder>;
} {
  const { recipient } = options;
  const many = "count" in recipient && recipient.count > 1;
  const who =
    "name" in recipient
      ? `the DM sent to ${escapeMarkdown(recipient.name)}`
      : many
        ? `the ${recipient.count} DMs sent by this action`
        : "the DM sent by this action";

  return {
    prompt: new TextDisplayBuilder().setContent(
      `**Delete ${who}?** They won't see the reason anymore. The case and its reason stay.`,
    ),
    row: new ActionRowBuilder<ButtonBuilder>().addComponents(
      button(
        many && "count" in recipient
          ? `Delete ${recipient.count} DMs`
          : "Delete DM",
        options.confirmCustomId,
        ButtonStyle.Danger,
      ),
      button("Cancel", options.cancelCustomId, ButtonStyle.Secondary),
    ),
  };
}

function buildButtonRow(
  input: ModLogMessageInput,
): ActionRowBuilder<ButtonBuilder> {
  const { moderationCase, emojis } = input;
  const reasonId = buildModLogReasonButtonId(moderationCase.caseId);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    moderationCase.reason
      ? button(
          "Edit reason",
          reasonId,
          ButtonStyle.Secondary,
          emojis.message_edit,
        )
      : button(
          "Set reason",
          reasonId,
          ButtonStyle.Primary,
          emojis.message_edit,
        ),
  );

  const deleteDmId = hasLiveDm(moderationCase)
    ? buildModLogDeleteDmButtonId(moderationCase)
    : null;
  if (deleteDmId) {
    row.addComponents(
      button("Delete DM", deleteDmId, ButtonStyle.Secondary, emojis.trash),
    );
  }

  return row;
}

export function buildModLogMessage(input: ModLogMessageInput): ModLogMessage {
  const { moderationCase, target, emojis } = input;
  const type = moderationCase.actionType;

  const title = withEmoji(
    emojis[getActionTypeBotEmoji(type)],
    `${ACTION_TITLES[type] ?? formatActionTypeAsSentence(type)} · Case #${moderationCase.caseId}`,
  );
  const executorId = moderationCase.executorId ?? input.fallbackExecutorId;
  // The tag keeps former mods identifiable when the mention can't resolve.
  const moderatorLines = executorId
    ? [
        `**Moderator:** <@${executorId}>`,
        ...(input.executorTag
          ? [`-# ${escapeMarkdown(input.executorTag)}`]
          : []),
      ]
    : [];
  const header = [
    `### ${title}`,
    `**User:** <@${target.id}>`,
    `-# ${escapeMarkdown(target.username)} · \`${target.id}\``,
    ...moderatorLines,
  ].join("\n");

  const { media, links } = splitAttachments(moderationCase.attachments);
  let factsText: string | null;
  if (input.factsBlock && !input.timeoutChange) {
    factsText = input.factsBlock;
  } else {
    const facts = [...buildFacts(input), ...(input.extraFacts ?? [])];
    if (links.length > 0) {
      facts.push(attachmentLinks(links));
    }
    factsText =
      facts.length > 0 ? facts.map((fact) => `-# ${fact}`).join("\n") : null;
  }

  const dmLine = dmStatusLine(input);
  const footerText = [
    ...(dmLine ? [`-# ${dmLine}`] : []),
    `-# <t:${unix(moderationCase.actionTime)}:f>`,
  ].join("\n");

  // Only worth showing when someone other than the moderator wrote the reason.
  const reasonSetNote =
    moderationCase.reasonSetBy &&
    moderationCase.reasonSetAt &&
    moderationCase.reasonSetBy !== executorId
      ? `\n-# Set by <@${moderationCase.reasonSetBy}> <t:${unix(moderationCase.reasonSetAt)}:R>`
      : "";
  const reasonHeading = "**Reason**\n";

  const confirm = input.confirmDeleteDm
    ? buildDeleteDmConfirm({
        recipient: { name: target.username },
        confirmCustomId: buildModLogDmConfirmId(
          "deleteConfirm",
          moderationCase.caseId,
        ),
        cancelCustomId: buildModLogDmConfirmId("cancel", moderationCase.caseId),
      })
    : null;

  const fixedLength =
    header.length +
    (factsText?.length ?? 0) +
    footerText.length +
    (confirm?.prompt.data.content?.length ?? 0) +
    reasonHeading.length +
    reasonSetNote.length;
  const reasonBody = moderationCase.reason
    ? truncateText(
        moderationCase.reason.value,
        MESSAGE_TEXT_MAX_LENGTH - fixedLength,
      )
    : "-# No reason yet. Set one so the case history explains this action.";

  const container = new ContainerBuilder()
    .setAccentColor(getActionTypeColor(type) ?? Color.Info)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(header))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(target.avatarURL)),
    );

  if (factsText) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setId(MOD_LOG_FACTS_ID).setContent(factsText),
    );
  }

  container
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        reasonHeading + reasonBody + reasonSetNote,
      ),
    );

  if (media.length > 0) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        media.map((url) => new MediaGalleryItemBuilder().setURL(url)),
      ),
    );
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(footerText),
  );

  container.addSeparatorComponents(
    new SeparatorBuilder()
      .setDivider(true)
      .setSpacing(SeparatorSpacingSize.Small),
  );

  if (confirm) {
    container
      .addTextDisplayComponents(confirm.prompt)
      .addActionRowComponents(confirm.row);
  } else {
    container.addActionRowComponents(buildButtonRow(input));
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

interface EntryJSON {
  embeds?: readonly {
    fields?: readonly { name: string; value: string }[];
  }[];
  components?: readonly unknown[];
}

/** Entries posted before components v2 lack the flag, whatever they contain now. */
export function isLegacyEntry(message: Pick<PostedMessage, "flags">): boolean {
  return !message.flags.has(MessageFlags.IsComponentsV2);
}

function findFactsBlock(node: unknown): string | null {
  if (!node || typeof node !== "object") {
    return null;
  }

  const component = node as {
    id?: number;
    content?: string;
    components?: unknown[];
  };
  if (component.id === MOD_LOG_FACTS_ID && component.content) {
    return component.content;
  }

  for (const child of component.components ?? []) {
    const found = findFactsBlock(child);
    if (found) {
      return found;
    }
  }

  return null;
}

/** The facts block of a components v2 entry, from the message JSON. */
export function extractFactsBlock(message: EntryJSON): string | null {
  for (const component of message.components ?? []) {
    const found = findFactsBlock(component);
    if (found) {
      return found;
    }
  }

  return null;
}

/**
 * Fact lines for embed fields a legacy entry showed that the case row can't
 * reproduce, copied as they were.
 */
export function extractLegacyFacts(
  message: EntryJSON,
  moderationCase: ModerationCase,
): string[] {
  const hasStoredDuration =
    moderationCase.timeoutDuration != null &&
    moderationCase.timeoutDuration > 0;
  const keep = new Set([
    ...LEGACY_UNSTORED_FIELDS,
    ...(hasStoredDuration ? [] : LEGACY_DURATION_FIELDS),
  ]);

  const facts: string[] = [];
  let length = 0;
  for (const field of (message.embeds ?? []).flatMap((e) => e.fields ?? [])) {
    if (!keep.has(field.name)) {
      continue;
    }

    const fact = `${field.name}: ${field.value.replace(/\n+/g, " · ")}`;
    if (length + fact.length > LEGACY_FACTS_MAX_LENGTH) {
      break;
    }
    facts.push(fact);
    length += fact.length;
  }

  return facts;
}

/**
 * REST body that converts a legacy embed entry. Discord lets an edit add the
 * components v2 flag but never remove it, and needs content set to null in
 * that edit, which discord.js would send as an empty string.
 */
export function buildLegacyConversionBody(
  message: ModLogMessage,
  existingFlags: number,
): {
  flags: number;
  components: unknown[];
  embeds: [];
  content: null;
  allowed_mentions: { parse: [] };
} {
  return {
    // Discord only accepts SuppressEmbeds from the flags a message already has.
    flags:
      (existingFlags & MessageFlags.SuppressEmbeds) |
      MessageFlags.IsComponentsV2,
    components: message.components.map((c) => c.toJSON()),
    embeds: [],
    content: null,
    allowed_mentions: { parse: [] },
  };
}
