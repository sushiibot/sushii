import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
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

import type { CaseProof } from "../../domain/entities/CaseProof";
import type { ModerationCase } from "../../domain/entities/ModerationCase";
import {
  ActionType,
  ActionTypeBotEmojis,
} from "../../domain/value-objects/ActionType";
import { isGalleryMedia } from "../caseMedia";
import {
  PROOF_EMOJIS,
  addProofButton,
  proofEntryText,
  proofFileLinks,
  proofHeading,
  proofMediaUrls,
} from "../proof/proofBlock";
import {
  REASON_EMOJIS,
  dmKind,
  hasLiveDm,
  reasonDelivery,
  reasonHeading,
} from "../proof/reasonBlock";
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
  ...PROOF_EMOJIS,
  ...REASON_EMOJIS,
  "duration",
  "trash",
  "message_edit",
] as const satisfies readonly BotEmojiNameType[];

export type ModLogEmojis = EmojiMap<typeof MOD_LOG_EMOJIS>;

/** Discord's cap on text across all text displays in one message. */
export const MESSAGE_TEXT_MAX_LENGTH = 4000;
const LEGACY_DM_DELETED_LABEL = "Reason DM deleted";

/** What the entry needs of a proof; attachments may be `attachment://` refs to files in the same request. */
export type ModLogProof = Pick<
  CaseProof,
  | "authorId"
  | "createdAt"
  | "content"
  | "attachments"
  | "sourceMessageUrl"
  | "sourceAuthorId"
  | "sourceContent"
>;

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
  /** Proof shown on this entry, oldest first. Proof hosted on overflow replies is left out. */
  proofs?: readonly ModLogProof[];
  /** Raw link to the first overflow reply, when any proof lives there. */
  moreProofUrl?: string | null;
  /** The DM carried the server's custom text for this action from `/settings`. */
  dmIncludedServerText?: boolean;
  /** Swaps the reason's button row for the in-place Delete DM confirmation. */
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

export { hasLiveDm };

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

/** Notes store their text in the reason field but read as a note everywhere else. */
function reasonLabel(type: ActionType): "reason" | "note" {
  return type === ActionType.Note ? "note" : "reason";
}

function buildReasonRow(
  input: ModLogMessageInput,
): ActionRowBuilder<ButtonBuilder> {
  const { moderationCase, emojis } = input;
  const reasonId = buildModLogReasonButtonId(moderationCase.caseId);
  const label = reasonLabel(moderationCase.actionType);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    moderationCase.reason
      ? button(
          `Edit ${label}`,
          reasonId,
          ButtonStyle.Secondary,
          emojis.message_edit,
        )
      : button(
          `Set ${label}`,
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

function buildReasonHeading(input: ModLogMessageInput): string {
  const { moderationCase, emojis } = input;
  if (moderationCase.actionType === ActionType.Note) {
    return "**Note**";
  }

  if (hasLiveDm(moderationCase)) {
    return reasonHeading(emojis, { sent: true, to: "user" });
  }

  const delivery = reasonDelivery(moderationCase);
  return reasonHeading(emojis, {
    sent: false,
    why: (!delivery.sent && delivery.why) || undefined,
  });
}

function buildReasonText(input: ModLogMessageInput): string {
  const { moderationCase } = input;
  const executorId =
    moderationCase.executorId ?? input.fallbackExecutorId ?? null;
  const label = reasonLabel(moderationCase.actionType);
  const lines = [
    buildReasonHeading(input),
    moderationCase.reason
      ? moderationCase.reason.value
      : `-# No ${label} yet. Set one so the case history explains this action.`,
  ];

  // Only worth showing when someone other than the moderator wrote the reason.
  if (
    moderationCase.reasonSetBy &&
    moderationCase.reasonSetAt &&
    moderationCase.reasonSetBy !== executorId
  ) {
    lines.push(
      `-# Set by <@${moderationCase.reasonSetBy}> <t:${unix(moderationCase.reasonSetAt)}:R>`,
    );
  }

  const kind = dmKind(moderationCase.actionType);
  if (input.dmIncludedServerText && hasLiveDm(moderationCase) && kind) {
    lines.push(`-# Also included your server's ${kind} message`);
  }

  return lines.join("\n");
}

/** Pending uploads are `attachment://` refs; a link to one would be dead text. */
function isPendingUpload(url: string): boolean {
  return url.startsWith("attachment://");
}

function buildProofText(input: ModLogMessageInput): string {
  const { emojis } = input;
  const proofs = input.proofs ?? [];
  const lines = [proofHeading(emojis)];
  if (proofs.length === 0 && !input.moreProofUrl) {
    lines.push(
      "-# None yet. Add screenshots, message links or context for other mods.",
    );
  }
  for (const proof of proofs) {
    lines.push(proofEntryText(proof, emojis));
  }
  if (input.moreProofUrl) {
    lines.push(`-# More proof in the reply below: ${input.moreProofUrl}`);
  }

  return lines.join("\n");
}

/** Lines a copied facts block had for the attachments column, now shown as proof. */
function withoutAttachmentFacts(factsBlock: string): string | null {
  const kept = factsBlock
    .split("\n")
    .filter((line) => !line.startsWith("-# Attachments: "));
  return kept.length > 0 ? kept.join("\n") : null;
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

  let factsText: string | null;
  if (input.factsBlock && !input.timeoutChange) {
    factsText = withoutAttachmentFacts(input.factsBlock);
  } else {
    const facts = [...buildFacts(input), ...(input.extraFacts ?? [])];
    factsText =
      facts.length > 0 ? facts.map((fact) => `-# ${fact}`).join("\n") : null;
  }

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
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(buildReasonText(input)),
    );

  if (confirm) {
    container
      .addTextDisplayComponents(confirm.prompt)
      .addActionRowComponents(confirm.row);
  } else {
    container.addActionRowComponents(buildReasonRow(input));
  }

  const proofs = input.proofs ?? [];
  container
    .addSeparatorComponents(separator())
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(buildProofText(input)),
        )
        .setButtonAccessory(addProofButton([moderationCase.caseId], emojis)),
    );

  const media = proofMediaUrls(proofs);
  if (media.length > 0) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        media.map((url) => new MediaGalleryItemBuilder().setURL(url)),
      ),
    );
  }

  const links = proofFileLinks(proofs).filter((url) => !isPendingUpload(url));
  if (links.length > 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(links.join("\n")),
    );
  }

  // Timestamps render as a full-size pill even in small text, so it sits last like a footer.
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `-# <t:${unix(moderationCase.actionTime)}:f>`,
    ),
  );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

function separator(): SeparatorBuilder {
  return new SeparatorBuilder()
    .setDivider(true)
    .setSpacing(SeparatorSpacingSize.Small);
}

/** Text Discord counts toward its 4000-character limit: every text display. */
export function messageTextLength(message: {
  components: readonly { toJSON(): unknown }[];
}): number {
  let total = 0;
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") {
      return;
    }
    const component = node as {
      type?: number;
      content?: string;
      components?: unknown[];
    };
    if (component.type === ComponentType.TextDisplay && component.content) {
      total += component.content.length;
    }
    for (const child of component.components ?? []) {
      walk(child);
    }
  };
  for (const component of message.components) {
    walk(component.toJSON());
  }

  return total;
}

/** Gallery items the entry would show, so a fit check can keep uploads visible. */
export function galleryItemCount(proofs: readonly ModLogProof[]): number {
  return proofs
    .flatMap((proof) => proof.attachments)
    .filter(Boolean)
    .filter(isGalleryMedia).length;
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
