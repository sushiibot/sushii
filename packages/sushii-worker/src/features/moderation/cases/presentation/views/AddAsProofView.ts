import type { InteractionReplyOptions, MessageEditOptions } from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  UserSelectMenuBuilder,
} from "discord.js";

import type { EmojiMap } from "@/features/bot-emojis";
import type { CaseProof } from "@/features/moderation/shared/domain/entities/CaseProof";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import { ActionTypeBotEmojis } from "@/features/moderation/shared/domain/value-objects/ActionType";
import {
  formatActionTypeAsSentence,
  getActionTypeBotEmoji,
} from "@/features/moderation/shared/presentation/views/ActionTypeFormatter";
import dayjs from "@/shared/domain/dayjs";
import { countWithNoun } from "@/shared/presentation/pluralize";
import Color from "@/utils/colors";
import { quoteMarkdownString } from "@/utils/markdown";
import { truncateText } from "@/utils/truncateText";

export const ADD_AS_PROOF_EMOJIS = ActionTypeBotEmojis;
export type AddAsProofEmojis = EmojiMap<typeof ADD_AS_PROOF_EMOJIS>;

/** The author's newest case is a button; the select holds the next ones. */
export const PICKER_CASE_LIMIT = 10;

const SELECT_TEXT_MAX_LENGTH = 100;
const BUTTON_LABEL_MAX_LENGTH = 80;
const QUOTE_PREVIEW_MAX_LENGTH = 300;

export const SOURCE_CONTENT_MAX_LENGTH = 1500;
export const SOURCE_SHORTENED_LINE =
  "-# (message text shortened; full text at the link)";

// ---------------------------------------------------------------------------
// Custom ids

const PREFIX = "proof/ctx/";
const SNOWFLAKE = /^\d{17,20}$/;
const CASE_ID = /^\d{1,18}$/;

export interface SourceMessageRef {
  channelId: string;
  messageId: string;
}

export type AddAsProofCustomId =
  | ({ kind: "add"; caseId: string } & SourceMessageRef)
  | ({ kind: "pick" } & SourceMessageRef)
  | ({ kind: "user" } & SourceMessageRef);

export function buildAddAsProofCustomId(id: AddAsProofCustomId): string {
  const base = `${PREFIX}${id.kind}/${id.channelId}/${id.messageId}`;
  return id.kind === "add" ? `${base}/${id.caseId}` : base;
}

export function parseAddAsProofCustomId(
  customId: string,
): AddAsProofCustomId | null {
  if (!customId.startsWith(PREFIX)) {
    return null;
  }

  const [kind, channelId, messageId, caseId, ...rest] = customId
    .slice(PREFIX.length)
    .split("/");
  if (rest.length > 0 || !SNOWFLAKE.test(channelId ?? "")) {
    return null;
  }
  if (!SNOWFLAKE.test(messageId ?? "")) {
    return null;
  }

  const ref = { channelId, messageId };
  if (kind === "add") {
    return caseId !== undefined && CASE_ID.test(caseId)
      ? { kind, caseId, ...ref }
      : null;
  }
  if ((kind === "pick" || kind === "user") && caseId === undefined) {
    return { kind, ...ref };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Source message

/** The parts of a message the picker and the stored proof use. */
export interface SourceMessage {
  id: string;
  channelId: string;
  url: string;
  authorId: string;
  content: string;
  files: { contentType: string | null }[];
}

function collapseBlankLines(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\n(?:[ \t]*\n){2,}/g, "\n\n");
}

/**
 * The message text stored with the proof. The mod log quotes it, which
 * doubles newline-heavy text, so it's capped well under one entry's 4000.
 */
export function proofSourceContent(content: string): string | null {
  const text = collapseBlankLines(content).trim();
  if (!text) {
    return null;
  }
  if (text.length <= SOURCE_CONTENT_MAX_LENGTH) {
    return text;
  }

  const room = SOURCE_CONTENT_MAX_LENGTH - SOURCE_SHORTENED_LINE.length - 1;
  return `${truncateText(text, room)}\n${SOURCE_SHORTENED_LINE}`;
}

function fileNoun(files: SourceMessage["files"]): string {
  return files.every((f) => f.contentType?.startsWith("image/"))
    ? "image"
    : "file";
}

function fileCount(files: SourceMessage["files"]): string {
  return countWithNoun(files.length, fileNoun(files));
}

function quoteLines(message: SourceMessage): string {
  const lines = ["**Add this message as proof**"];
  const text = collapseBlankLines(message.content).trim();
  if (text) {
    lines.push(
      quoteMarkdownString(truncateText(text, QUOTE_PREVIEW_MAX_LENGTH)),
    );
  }

  let from = `-# From <@${message.authorId}> in <#${message.channelId}>`;
  if (message.files.length > 0) {
    from += ` · ${fileCount(message.files)}`;
  }
  lines.push(from);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Picker

/**
 * - `author`: the message author's cases, shown first
 * - `other`: a user picked in the user select
 */
export interface PickerInput {
  message: SourceMessage;
  /** Whose cases are listed. */
  user: { id: string; username: string };
  showing: "author" | "other";
  /** Newest first. */
  cases: readonly ModerationCase[];
  emojis: AddAsProofEmojis;
  now?: Date;
}

function caseAge(moderationCase: ModerationCase, now: Date): string {
  return dayjs(moderationCase.actionTime).from(now);
}

function caseLabel(moderationCase: ModerationCase, now: Date): string {
  return `#${moderationCase.caseId} ${formatActionTypeAsSentence(moderationCase.actionType)} · ${caseAge(moderationCase, now)}`;
}

function actionEmoji(
  moderationCase: ModerationCase,
  emojis: AddAsProofEmojis,
): string {
  return emojis[getActionTypeBotEmoji(moderationCase.actionType)] ?? "";
}

function newestCaseButton(
  input: PickerInput,
  moderationCase: ModerationCase,
  now: Date,
): ButtonBuilder {
  const button = new ButtonBuilder()
    .setCustomId(
      buildAddAsProofCustomId({
        kind: "add",
        caseId: moderationCase.caseId,
        channelId: input.message.channelId,
        messageId: input.message.id,
      }),
    )
    .setStyle(ButtonStyle.Primary)
    .setLabel(
      truncateText(
        `Add to #${moderationCase.caseId} · ${formatActionTypeAsSentence(moderationCase.actionType)} · ${caseAge(moderationCase, now)}`,
        BUTTON_LABEL_MAX_LENGTH,
      ),
    );

  const emoji = actionEmoji(moderationCase, input.emojis);
  if (emoji) {
    button.setEmoji(emoji);
  }
  return button;
}

function otherCasesSelect(
  input: PickerInput,
  cases: readonly ModerationCase[],
  now: Date,
): StringSelectMenuBuilder {
  const options = cases.map((c) => {
    const option = new StringSelectMenuOptionBuilder()
      .setValue(c.caseId)
      .setLabel(truncateText(caseLabel(c, now), SELECT_TEXT_MAX_LENGTH));

    const reason = c.reason?.value.replace(/\s+/g, " ").trim();
    if (reason) {
      option.setDescription(truncateText(reason, SELECT_TEXT_MAX_LENGTH));
    }

    const emoji = actionEmoji(c, input.emojis);
    if (emoji) {
      option.setEmoji(emoji);
    }
    return option;
  });

  return new StringSelectMenuBuilder()
    .setCustomId(
      buildAddAsProofCustomId({
        kind: "pick",
        channelId: input.message.channelId,
        messageId: input.message.id,
      }),
    )
    .setPlaceholder(
      truncateText(
        `Or another of ${input.user.username}'s cases…`,
        SELECT_TEXT_MAX_LENGTH,
      ),
    )
    .addOptions(options);
}

function userSelect(input: PickerInput): UserSelectMenuBuilder {
  const select = new UserSelectMenuBuilder()
    .setCustomId(
      buildAddAsProofCustomId({
        kind: "user",
        channelId: input.message.channelId,
        messageId: input.message.id,
      }),
    )
    .setPlaceholder("Someone else's case…");

  if (input.showing === "other") {
    select.setDefaultUsers(input.user.id);
  }
  return select;
}

export function buildAddAsProofPicker(
  input: PickerInput,
): InteractionReplyOptions & MessageEditOptions & { flags: number } {
  const now = input.now ?? new Date();
  const [newest, ...older] = input.cases.slice(0, PICKER_CASE_LIMIT);

  let text = quoteLines(input.message);
  if (!newest) {
    text += `\n-# <@${input.user.id}> has no cases. Pick whose case this is for, or use \`/note\` to keep a note about them.`;
  } else if (input.showing === "other") {
    text += `\n-# Showing <@${input.user.id}>'s cases`;
  }

  const container = new ContainerBuilder()
    .setAccentColor(Color.Info)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));

  if (newest) {
    container.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        newestCaseButton(input, newest, now),
      ),
    );
  }
  if (older.length > 0) {
    container.addActionRowComponents(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        otherCasesSelect(input, older, now),
      ),
    );
  }
  container.addActionRowComponents(
    new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      userSelect(input),
    ),
  );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  };
}

// ---------------------------------------------------------------------------
// Confirmation

function savedParts(proof: CaseProof, files: SourceMessage["files"]): string {
  const parts = ["Message link"];
  if (proof.sourceContent) {
    parts.push("text");
  }
  if (files.length > 0) {
    parts.push(fileCount(files));
  }
  const last = parts.pop();
  return parts.length > 0 ? `${parts.join(", ")} and ${last}` : `${last}`;
}

export function buildAddAsProofDone(input: {
  moderationCase: ModerationCase;
  proof: CaseProof;
  /** The message's files, all re-uploaded with the proof. */
  files: SourceMessage["files"];
  emojis: AddAsProofEmojis;
}): MessageEditOptions & { flags: number } {
  const { moderationCase, proof } = input;
  const emoji = actionEmoji(moderationCase, input.emojis);
  const action = formatActionTypeAsSentence(moderationCase.actionType);

  let saved = `-# ${savedParts(proof, input.files)} saved`;
  if (proof.hostMessageId) {
    saved += " · mod log entry updated";
  }

  const text = [
    `✅ Added to case #${moderationCase.caseId} as proof · ${emoji ? `${emoji} ` : ""}${action} · <@${moderationCase.userId}>`,
    saved,
  ].join("\n");

  return {
    components: [
      new ContainerBuilder()
        .setAccentColor(Color.Success)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(text)),
    ],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}
