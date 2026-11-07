import type {
  InteractionReplyOptions,
  MessageEditOptions,
  ModalSubmitFields,
} from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
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

/** Discord's limit for one select. */
export const PICKER_CASE_LIMIT = 25;

const SELECT_TEXT_MAX_LENGTH = 100;
const BUTTON_LABEL_MAX_LENGTH = 80;
const QUOTE_PREVIEW_MAX_LENGTH = 300;
const REASON_PREVIEW_MAX_LENGTH = 200;

export const SOURCE_CONTENT_MAX_LENGTH = 1500;
export const SOURCE_SHORTENED_LINE =
  "-# (message text shortened; full text at the link)";

// ---------------------------------------------------------------------------
// Custom ids

const PREFIX = "proof/ctx/";
const UNDO_PREFIX = "proof/undo/";
const SNOWFLAKE = /^\d{17,20}$/;
const CASE_ID = /^\d{1,18}$/;
const PROOF_ID = /^\d{1,20}$/;

export interface SourceMessageRef {
  channelId: string;
  messageId: string;
}

/** Whose cases the picker lists: the server's newest, or the message author's. */
export type PickerScope = "recent" | "author";

export type AddAsProofCustomId =
  | ({ kind: "pick" } & SourceMessageRef)
  | ({ kind: "scope"; scope: PickerScope } & SourceMessageRef)
  | ({ kind: "number"; scope: PickerScope } & SourceMessageRef);

export function buildAddAsProofCustomId(id: AddAsProofCustomId): string {
  const base = `${PREFIX}${id.kind}/${id.channelId}/${id.messageId}`;
  return id.kind === "pick" ? base : `${base}/${id.scope}`;
}

function isScope(value: string | undefined): value is PickerScope {
  return value === "recent" || value === "author";
}

export function parseAddAsProofCustomId(
  customId: string,
): AddAsProofCustomId | null {
  if (!customId.startsWith(PREFIX)) {
    return null;
  }

  const [kind, channelId, messageId, scope, ...rest] = customId
    .slice(PREFIX.length)
    .split("/");
  if (rest.length > 0 || !SNOWFLAKE.test(channelId ?? "")) {
    return null;
  }
  if (!SNOWFLAKE.test(messageId ?? "")) {
    return null;
  }

  const ref = { channelId, messageId };
  if (kind === "pick" && scope === undefined) {
    return { kind, ...ref };
  }
  if ((kind === "scope" || kind === "number") && isScope(scope)) {
    return { kind, scope, ...ref };
  }
  return null;
}

export interface AddAsProofUndoId {
  caseId: string;
  proofId: string;
}

export function buildAddAsProofUndoCustomId(id: AddAsProofUndoId): string {
  return `${UNDO_PREFIX}${id.caseId}/${id.proofId}`;
}

export function parseAddAsProofUndoCustomId(
  customId: string,
): AddAsProofUndoId | null {
  if (!customId.startsWith(UNDO_PREFIX)) {
    return null;
  }

  const [caseId, proofId, ...rest] = customId
    .slice(UNDO_PREFIX.length)
    .split("/");
  if (
    rest.length > 0 ||
    !CASE_ID.test(caseId ?? "") ||
    !PROOF_ID.test(proofId ?? "")
  ) {
    return null;
  }
  return { caseId, proofId };
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
  /** A forward: content and files come from its snapshot, and the original author isn't known. */
  forwarded: boolean;
}

function collapseBlankLines(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\n(?:[ \t]*\n){2,}/g, "\n\n");
}

/**
 * The message text stored with the proof. The mod log quotes it, which
 * doubles newline-heavy text, so it's capped well under one entry's 4000.
 */
export function proofSourceContent(
  content: string,
  opts: { forwardedBy?: string } = {},
): string | null {
  const header = opts.forwardedBy ? `Forwarded by <@${opts.forwardedBy}>` : "";
  const text = collapseBlankLines(content).trim();
  const join = (body: string) =>
    header && body ? `${header}\n${body}` : header || body;

  const whole = join(text);
  if (!whole) {
    return null;
  }
  if (whole.length <= SOURCE_CONTENT_MAX_LENGTH) {
    return whole;
  }

  const room =
    SOURCE_CONTENT_MAX_LENGTH -
    (header ? header.length + 1 : 0) -
    SOURCE_SHORTENED_LINE.length -
    1;
  return `${join(truncateText(text, room))}\n${SOURCE_SHORTENED_LINE}`;
}

function fileNoun(files: SourceMessage["files"]): string {
  return files.every((f) => f.contentType?.startsWith("image/"))
    ? "image"
    : "file";
}

function fileCount(
  files: SourceMessage["files"],
  count: number = files.length,
): string {
  return countWithNoun(count, fileNoun(files));
}

function quoteLines(message: SourceMessage): string {
  const lines = ["**Add this message as proof**"];
  const text = collapseBlankLines(message.content).trim();
  if (text) {
    lines.push(
      quoteMarkdownString(truncateText(text, QUOTE_PREVIEW_MAX_LENGTH)),
    );
  }

  let from = message.forwarded
    ? `-# Forwarded message, sent by <@${message.authorId}> in <#${message.channelId}>`
    : `-# From <@${message.authorId}> in <#${message.channelId}>`;
  if (message.files.length > 0) {
    from += ` · ${fileCount(message.files)}`;
  }
  lines.push(from);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Picker

export interface PickerInput {
  message: SourceMessage;
  /** Who the author filter shows; a forward has no filter, since its author isn't known. */
  author: { id: string; username: string };
  scope: PickerScope;
  /** Newest first. */
  cases: readonly ModerationCase[];
  emojis: AddAsProofEmojis;
  now?: Date;
  /** Shown under the message, e.g. why a typed case number wasn't used. */
  notice?: string;
}

function caseAge(moderationCase: ModerationCase, now: Date): string {
  return dayjs(moderationCase.actionTime).from(now);
}

function caseLabel(
  moderationCase: ModerationCase,
  scope: PickerScope,
  now: Date,
): string {
  const parts = [
    `#${moderationCase.caseId} ${formatActionTypeAsSentence(moderationCase.actionType)}`,
    ...(scope === "recent" ? [moderationCase.userTag] : []),
    caseAge(moderationCase, now),
  ];
  return parts.join(" · ");
}

function actionEmoji(
  moderationCase: ModerationCase,
  emojis: AddAsProofEmojis,
): string {
  return emojis[getActionTypeBotEmoji(moderationCase.actionType)] ?? "";
}

function casesSelect(input: PickerInput, now: Date): StringSelectMenuBuilder {
  const options = input.cases.slice(0, PICKER_CASE_LIMIT).map((c) => {
    const option = new StringSelectMenuOptionBuilder()
      .setValue(c.caseId)
      .setLabel(
        truncateText(caseLabel(c, input.scope, now), SELECT_TEXT_MAX_LENGTH),
      );

    const reason = oneLineReason(c);
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
        input.scope === "author"
          ? `Pick one of ${input.author.username}'s cases…`
          : "Pick a recent case…",
        SELECT_TEXT_MAX_LENGTH,
      ),
    )
    .addOptions(options);
}

function oneLineReason(moderationCase: ModerationCase): string | undefined {
  return moderationCase.reason?.value.replace(/\s+/g, " ").trim();
}

function pickerButtons(input: PickerInput): ButtonBuilder[] {
  const ref = {
    channelId: input.message.channelId,
    messageId: input.message.id,
  };
  const buttons = [
    new ButtonBuilder()
      .setCustomId(
        buildAddAsProofCustomId({ kind: "number", scope: input.scope, ...ref }),
      )
      .setStyle(ButtonStyle.Secondary)
      .setLabel("Enter case number…"),
  ];

  if (!input.message.forwarded) {
    const toAuthor = input.scope === "recent";
    buttons.push(
      new ButtonBuilder()
        .setCustomId(
          buildAddAsProofCustomId({
            kind: "scope",
            scope: toAuthor ? "author" : "recent",
            ...ref,
          }),
        )
        .setStyle(ButtonStyle.Secondary)
        .setLabel(
          toAuthor
            ? truncateText(
                `Show only ${input.author.username}'s cases`,
                BUTTON_LABEL_MAX_LENGTH,
              )
            : "Show all recent cases",
        ),
    );
  }
  return buttons;
}

function pickerHints(input: PickerInput): string[] {
  const hints: string[] = [];
  if (input.message.forwarded) {
    hints.push(
      "-# Forwards don't say who first wrote them, so there's no filter for one user.",
    );
  }
  if (input.scope === "author") {
    hints.push(
      input.cases.length > 0
        ? `-# Showing <@${input.author.id}>'s cases`
        : `-# <@${input.author.id}> has no cases. Use \`/note\` to keep a note about them.`,
    );
  } else if (input.cases.length === 0) {
    hints.push(
      "-# This server has no cases yet, so there's nothing to add this to.",
    );
  }
  if (input.notice) {
    hints.push(input.notice);
  }
  return hints;
}

export function buildAddAsProofPicker(
  input: PickerInput,
): InteractionReplyOptions & MessageEditOptions & { flags: number } {
  const now = input.now ?? new Date();
  const text = [quoteLines(input.message), ...pickerHints(input)].join("\n");

  const container = new ContainerBuilder()
    .setAccentColor(Color.Info)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));

  if (input.cases.length > 0) {
    container.addActionRowComponents(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        casesSelect(input, now),
      ),
    );
  }
  if (input.cases.length > 0 || input.scope === "author") {
    container.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(pickerButtons(input)),
    );
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  };
}

// ---------------------------------------------------------------------------
// Case number modal

const CASE_NUMBER_FIELD_ID = "case";

export function buildCaseNumberModal(customId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle("Add to a case")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Case number")
        .setDescription(
          "Copy it from the mod log or /history. It's added right away, and you can undo it.",
        )
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(CASE_NUMBER_FIELD_ID)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("e.g. 412 or #412")
            .setRequired(true)
            .setMaxLength(19),
        ),
    );
}

/** The case id typed into the modal; null when it isn't a number. */
export function readCaseNumber(fields: ModalSubmitFields): string | null {
  const typed = fields
    .getTextInputValue(CASE_NUMBER_FIELD_ID)
    .trim()
    .replace(/^#/, "");
  return CASE_ID.test(typed) ? typed : null;
}

export function caseNumberNotice(caseId: string | null): string {
  return caseId
    ? `-# ❌ No case #${caseId} in this server. Check the number and try again.`
    : "-# ❌ That isn't a case number. Copy it from the mod log or `/history`.";
}

// ---------------------------------------------------------------------------
// Confirmation

function savedParts(proof: CaseProof, files: SourceMessage["files"]): string {
  const parts = ["Message link"];
  if (proof.sourceContent) {
    parts.push("text");
  }
  if (proof.attachments.length > 0) {
    parts.push(fileCount(files, proof.attachments.length));
  }
  const last = parts.pop();
  return parts.length > 0 ? `${parts.join(", ")} and ${last}` : `${last}`;
}

function caseDetailLines(
  moderationCase: ModerationCase,
  emojis: AddAsProofEmojis,
  now: Date,
): string[] {
  const emoji = actionEmoji(moderationCase, emojis);
  const action = formatActionTypeAsSentence(moderationCase.actionType);
  const reason = oneLineReason(moderationCase);
  return [
    `${emoji ? `${emoji} ` : ""}${action} · <@${moderationCase.userId}> · ${caseAge(moderationCase, now)}`,
    reason
      ? quoteMarkdownString(truncateText(reason, REASON_PREVIEW_MAX_LENGTH))
      : "-# No reason set",
  ];
}

function undoButton(id: AddAsProofUndoId): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildAddAsProofUndoCustomId(id))
      .setStyle(ButtonStyle.Secondary)
      .setLabel("Undo"),
  );
}

function filesNotSavedLine(
  files: SourceMessage["files"],
  reason: string,
): string {
  const what =
    files.length === 1
      ? `The ${fileNoun(files)} wasn't saved`
      : `None of the ${fileCount(files)} were saved`;
  return `-# ${what}: ${reason}`;
}

export function buildAddAsProofDone(input: {
  moderationCase: ModerationCase;
  proof: CaseProof;
  /** The message's files; only names images vs. files, the count comes from the proof. */
  files: SourceMessage["files"];
  emojis: AddAsProofEmojis;
  /** Why the message's files weren't stored, when only its link and text were. */
  filesNotSaved?: string;
  now?: Date;
}): MessageEditOptions & { flags: number } {
  const { moderationCase, proof } = input;

  let saved = `-# ${savedParts(proof, input.files)} saved`;
  if (proof.hostMessageId) {
    saved += " · mod log entry updated";
  }

  const text = [
    `✅ **Added as proof to case #${moderationCase.caseId}**`,
    ...caseDetailLines(moderationCase, input.emojis, input.now ?? new Date()),
    saved,
    ...(input.filesNotSaved
      ? [filesNotSavedLine(input.files, input.filesNotSaved)]
      : []),
  ].join("\n");

  return {
    components: [
      new ContainerBuilder()
        .setAccentColor(Color.Success)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
        .addActionRowComponents(
          undoButton({ caseId: moderationCase.caseId, proofId: proof.id }),
        ),
    ],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

function statusMessage(
  text: string,
  color: Color,
  row?: ActionRowBuilder<ButtonBuilder>,
): MessageEditOptions & { flags: number } {
  const container = new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
  if (row) {
    container.addActionRowComponents(row);
  }
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

/** Shown in place of Done while the proof is removed, so Undo can't be clicked twice. */
export function buildAddAsProofUndoing(
  caseId: string,
): MessageEditOptions & { flags: number } {
  return statusMessage(`Removing the proof from case #${caseId}…`, Color.Info);
}

export function buildAddAsProofUndone(
  moderationCase: ModerationCase,
  emojis: AddAsProofEmojis,
): MessageEditOptions & { flags: number } {
  const emoji = actionEmoji(moderationCase, emojis);
  const action = formatActionTypeAsSentence(moderationCase.actionType);
  return statusMessage(
    `↩️ Removed from case #${moderationCase.caseId} · ${emoji ? `${emoji} ` : ""}${action} · <@${moderationCase.userId}>\n-# Right-click the message to add it to another case.`,
    Color.Info,
  );
}

export function buildAddAsProofUndoGone(
  caseId: string,
): MessageEditOptions & { flags: number } {
  return statusMessage(
    `That proof was already removed from case #${caseId}.`,
    Color.Error,
  );
}

export function buildAddAsProofUndoNotAllowed(): MessageEditOptions & {
  flags: number;
} {
  return statusMessage(
    "Only the mod who added this proof can undo it here.",
    Color.Error,
  );
}

/** The proof is still on the case, so Undo stays available. */
export function buildAddAsProofUndoFailed(
  id: AddAsProofUndoId,
): MessageEditOptions & { flags: number } {
  return statusMessage(
    `Couldn't remove the proof, so it's still on case #${id.caseId}. Try again.`,
    Color.Error,
    undoButton(id),
  );
}

/** Shown in place of the picker while the message is added, so it can't be picked twice. */
export function buildAddAsProofAdding(
  caseId: string,
): MessageEditOptions & { flags: number } {
  return {
    components: [
      new ContainerBuilder()
        .setAccentColor(Color.Info)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `Adding the message to case #${caseId}…`,
          ),
        ),
    ],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}
