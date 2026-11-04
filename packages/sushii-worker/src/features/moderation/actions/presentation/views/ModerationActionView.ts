import type {
  APIComponentInContainer,
  APIContainerComponent,
  APIMessageTopLevelComponent,
  APITextDisplayComponent,
  User,
} from "discord.js";
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
import type { Result } from "ts-results";

import type { BotEmojiNameType, EmojiMap } from "@/features/bot-emojis/domain";
import type { TemplateRef } from "@/features/moderation/reason-templates/domain/ReasonExpander";
import { guildDmText } from "@/features/moderation/shared/application/DMNotificationService";
import type { CaseProof } from "@/features/moderation/shared/domain/entities/CaseProof";
import type { ModerationAction } from "@/features/moderation/shared/domain/entities/ModerationAction";
import type {
  DMFailureReason,
  ModerationCase,
} from "@/features/moderation/shared/domain/entities/ModerationCase";
import type { ModerationTarget } from "@/features/moderation/shared/domain/entities/ModerationTarget";
import {
  ActionType,
  ActionTypeBotEmojis,
  actionTypeSupportsDM,
} from "@/features/moderation/shared/domain/value-objects/ActionType";
import { splitCaseAttachments } from "@/features/moderation/shared/presentation/caseMedia";
import {
  PROOF_EMOJIS,
  addProofButton,
  proofEntryText,
  proofFileLinks,
  proofHeading,
  proofMediaUrls,
} from "@/features/moderation/shared/presentation/proof/proofBlock";
import {
  type NotSentCause,
  REASON_EMOJIS,
  alsoIncludedLine,
  caseDmState,
  dmFailureText,
  hasLiveDm,
  notSentWhy,
  reasonHeading,
} from "@/features/moderation/shared/presentation/proof/reasonBlock";
import {
  getActionTypeBotEmoji,
  getActionTypeColor,
} from "@/features/moderation/shared/presentation/views/ActionTypeFormatter";
import { buildDeleteDmConfirm } from "@/features/moderation/shared/presentation/views/ModLogMessageView";
import dayjs from "@/shared/domain/dayjs";
import type { GuildConfig } from "@/shared/domain/entities/GuildConfig";
import Color from "@/utils/colors";
import { ELLIPSIS, truncateText } from "@/utils/truncateText";
import { getCleanFilename } from "@/utils/url";

import {
  buildResponseButtonId,
  encodeCaseIds,
  parseResponseButtonId,
  toCaseRuns,
} from "../response/customIds";

export const MODERATION_ACTION_EMOJIS = [
  ...ActionTypeBotEmojis,
  ...PROOF_EMOJIS,
  ...REASON_EMOJIS,
  "success",
  "fail",
  "message",
  "duration",
  "warning",
  "tip",
  "save",
  "trash",
  "message_edit",
] as const satisfies readonly BotEmojiNameType[];

export type ModerationActionEmojis = EmojiMap<typeof MODERATION_ACTION_EMOJIS>;

/**
 * Stable component ids. A button click rebuilds the response from reloaded
 * cases but copies `header` and `details` from the clicked message, since
 * failed-target errors and the typed duration aren't stored anywhere.
 * `reasonNotes`, `dm`, `reasonSection`, `dmSection` and `dmFooter` only
 * exist on responses posted before the reason block.
 */
export const ACTION_RESPONSE_IDS = {
  header: 2001,
  reason: 2002,
  reasonNotes: 2003,
  details: 2004,
  dm: 2005,
  prompt: 2006,
  footer: 2007,
  reasonSection: 2008,
  dmSection: 2009,
  dmFooter: 2010,
  media: 2011,
  reasonRow: 2012,
  confirm: 2013,
  proofSection: 2014,
  status: 2016,
} as const;

/**
 * The proof text display's id is this base plus the number of proof entries,
 * shown or behind "+N more", so a click can tell whether proof was added
 * elsewhere.
 */
export const PROOF_TEXT_ID_BASE = 2100;
const PROOF_TEXT_ID_MAX_COUNT = 899;

/** Action-time proof is saved after the response is posted, so it isn't counted. */
function proofTextId(proofs: readonly CaseProof[]): number {
  const count = proofs.filter((p) => p.source !== "action").length;
  return PROOF_TEXT_ID_BASE + Math.min(count, PROOF_TEXT_ID_MAX_COUNT);
}

/** The Delete DM button's id is this base plus the live DMs it deletes. */
export const LIVE_DM_BUTTON_ID_BASE = 3000;
const LIVE_DM_BUTTON_ID_MAX_COUNT = 99;

function liveDmButtonId(live: number): number {
  return LIVE_DM_BUTTON_ID_BASE + Math.min(live, LIVE_DM_BUTTON_ID_MAX_COUNT);
}

function isProofTextId(id: number | undefined): boolean {
  return (
    id !== undefined &&
    id >= PROOF_TEXT_ID_BASE &&
    id <= PROOF_TEXT_ID_BASE + PROOF_TEXT_ID_MAX_COUNT
  );
}

export const RESPONSE_WINDOW_MS = 15 * 60 * 1000;

export const EXPIRED_LINE =
  "-# Buttons expired after 15 minutes. Later changes: the mod log entry or `/reason`.";

export const EXPIRED_CLICK_MESSAGE =
  "These buttons expired after 15 minutes. Change the reason from the mod log entry or with `/reason`.";

const STALE_PREFIX = "-# Changed in the mod log after this was posted.";

export const STALE_CLICK_MESSAGE =
  "This case changed in the mod log after this response was posted, so its buttons are off. Use the mod log entry or `/reason`.";

export function staleLine(modLogUrl: string | null): string {
  return modLogUrl
    ? `${STALE_PREFIX} Up-to-date entry: ${modLogUrl}`
    : `${STALE_PREFIX} The mod log entry is up to date.`;
}

const TOO_MANY_CASES_LINE =
  "-# These cases are too spread out for buttons. Change them from the mod log entries or with `/reason`.";

const NO_PROOF_LINE =
  "-# None yet. Add screenshots, message links or context for other mods.";

/** Discord's cap on text across all text displays in one message. */
const MESSAGE_TEXT_MAX_LENGTH = 4000;
const HEADER_MAX_LENGTH = 1800;
const TARGET_ERROR_MAX_LENGTH = 120;
const ATTACHMENTS_MAX_LENGTH = 400;
/** A message URL with 20-digit snowflakes. */
const MESSAGE_URL_MAX_LENGTH = 100;
const GALLERY_MAX_ITEMS = 10;
const TERMINAL_LINE_MAX_LENGTH = Math.max(
  EXPIRED_LINE.length,
  staleLine("x".repeat(MESSAGE_URL_MAX_LENGTH)).length,
);

export function isResponseExpired(
  createdTimestamp: number,
  now: number,
): boolean {
  return now - createdTimestamp >= RESPONSE_WINDOW_MS;
}

const VERBS: Partial<Record<ActionType, { done: string; fail: string }>> = {
  [ActionType.Ban]: { done: "Banned", fail: "ban" },
  [ActionType.TempBan]: { done: "Temporarily banned", fail: "ban" },
  [ActionType.BanRemove]: { done: "Unbanned", fail: "unban" },
  [ActionType.Softban]: { done: "Softbanned", fail: "softban" },
  [ActionType.Kick]: { done: "Kicked", fail: "kick" },
  [ActionType.Timeout]: { done: "Timed out", fail: "time out" },
  [ActionType.TimeoutAdjust]: {
    done: "Changed the timeout of",
    fail: "change the timeout of",
  },
  [ActionType.TimeoutRemove]: {
    done: "Removed the timeout of",
    fail: "remove the timeout of",
  },
  [ActionType.Warn]: { done: "Warned", fail: "warn" },
  [ActionType.Note]: { done: "Added a note to", fail: "add a note to" },
};

function verbs(actionType: ActionType): { done: string; fail: string } {
  return VERBS[actionType] ?? { done: "Moderated", fail: "act on" };
}

function withEmoji(emoji: string, text: string): string {
  return emoji ? `${emoji} ${text}` : text;
}

function unix(date: Date | dayjs.Dayjs): number {
  return dayjs(date).unix();
}

/** "Case #4822", or "Cases #4822–#4823, #4830". */
export function formatCaseRefs(caseIds: readonly string[]): string {
  const runs = toCaseRuns(caseIds).map((run) =>
    run
      .split("-")
      .map((id) => `#${id}`)
      .join("–"),
  );
  if (caseIds.length === 1) {
    return `Case ${runs[0]}`;
  }
  return `Cases ${runs.join(", ")}`;
}

function byline(caseIds: readonly string[], executor: User, at: Date): string {
  const parts = [
    caseIds.length > 0 ? formatCaseRefs(caseIds) : null,
    `by <@${executor.id}> (${escapeMarkdown(executor.username)})`,
    `<t:${unix(at)}:R>`,
  ].filter(Boolean);
  return `-# ${parts.join(" · ")}`;
}

interface TargetResult {
  target: ModerationTarget;
  result: Result<ModerationCase, string>;
}

function targetLine(
  entry: TargetResult,
  emojis: ModerationActionEmojis,
  failVerb: string,
): string {
  const { target, result } = entry;
  const chip = `<@${target.id}> · \`${target.id}\``;
  if (result.ok) {
    const failure = dmFailureOf(result.val);
    return failure
      ? `${withEmoji(emojis.success, chip)}\n-# ↳ DM failed: ${dmFailureText(failure)}`
      : withEmoji(emojis.success, chip);
  }

  const error = truncateText(result.val, TARGET_ERROR_MAX_LENGTH);
  return `${withEmoji(emojis.fail, chip)}\n-# ↳ Couldn't ${failVerb} ${escapeMarkdown(target.user.username)}: ${error}`;
}

type HeaderBuilder = (maxLength: number) => APIComponentInContainer;

function buildHeader(
  actionType: ActionType,
  executor: User,
  entries: TargetResult[],
  emojis: ModerationActionEmojis,
  now: Date,
  maxLength: number,
): SectionBuilder | TextDisplayBuilder {
  const { done, fail } = verbs(actionType);
  const actionEmoji = emojis[getActionTypeBotEmoji(actionType)];
  const caseIds = entries.flatMap((e) =>
    e.result.ok ? [e.result.val.caseId] : [],
  );
  const by = byline(caseIds, executor, now);

  if (entries.length === 1) {
    const [entry] = entries;
    const name = escapeMarkdown(entry.target.user.username);
    const title = entry.result.ok
      ? withEmoji(actionEmoji, `${done} ${name}`)
      : withEmoji(emojis.fail, `Couldn't ${fail} ${name}`);
    const errorLine = entry.result.ok
      ? ""
      : `\n-# ↳ ${truncateText(entry.result.val, TARGET_ERROR_MAX_LENGTH)}`;
    const text = `### ${title}\n<@${entry.target.id}> · \`${entry.target.id}\`${errorLine}\n${by}`;

    const section = new SectionBuilder()
      .setId(ACTION_RESPONSE_IDS.header)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
    const avatar = entry.target.avatarURL;
    if (avatar) {
      return section.setThumbnailAccessory(
        new ThumbnailBuilder().setURL(avatar),
      );
    }
    return new TextDisplayBuilder()
      .setId(ACTION_RESPONSE_IDS.header)
      .setContent(text);
  }

  const succeeded = caseIds.length;
  let title: string;
  if (succeeded === entries.length) {
    title = withEmoji(actionEmoji, `${done} ${succeeded} users`);
  } else if (succeeded === 0) {
    title = withEmoji(
      emojis.fail,
      `Couldn't ${fail} any of ${entries.length} users`,
    );
  } else {
    title = withEmoji(
      emojis.warning,
      `${done} ${succeeded} of ${entries.length} users`,
    );
  }

  const head = `### ${title}\n`;
  const budget = maxLength - head.length - by.length - 1;
  const lines: string[] = [];
  let length = 0;
  for (const [index, entry] of entries.entries()) {
    const line = targetLine(entry, emojis, fail);
    const remaining = entries.length - index;
    // Leaves room for the "and N more" line.
    if (length + line.length + 1 > budget - 30 && remaining > 1) {
      lines.push(`-# …and ${remaining} more`);
      break;
    }
    lines.push(line);
    length += line.length + 1;
  }

  return new TextDisplayBuilder()
    .setId(ACTION_RESPONSE_IDS.header)
    .setContent(`${head}${lines.join("\n")}\n${by}`);
}

/** Drops target lines from a posted multi-target header, keeping its title and byline. */
function fitHeaderText(content: string, maxLength: number): string {
  if (content.length <= maxLength) {
    return content;
  }
  const lines = content.split("\n");
  if (lines.length < 3) {
    return content;
  }
  const first = lines[0];
  const last = lines[lines.length - 1];
  const middle = lines.slice(1, -1);
  const more = "-# …and more";
  while (middle.length > 0) {
    middle.pop();
    const fitted = [first, ...middle, more, last].join("\n");
    if (fitted.length <= maxLength) {
      return fitted;
    }
  }
  return [first, more, last].join("\n");
}

function buildDetails(
  input: ActionResultInput,
  now: Date,
): TextDisplayBuilder | null {
  const { action, emojis } = input;
  if (!action.isTemporalAction()) {
    return null;
  }

  const end = dayjs(now).add(action.duration.value);
  return new TextDisplayBuilder()
    .setId(ACTION_RESPONSE_IDS.details)
    .setContent(
      `-# ${withEmoji(emojis.duration, `${escapeMarkdown(action.duration.originalString)} · ends <t:${unix(end)}:f>`)}`,
    );
}

function dmFailureOf(moderationCase: ModerationCase): DMFailureReason | null {
  const state = caseDmState(moderationCase);
  return state.kind === "failed" ? state.reason : null;
}

function sameValue<T>(values: T[]): T | null {
  return values.length > 0 && values.every((v) => v === values[0])
    ? values[0]
    : null;
}

function deletedBy(cases: ModerationCase[]): string {
  const deleted = cases.filter((c) => c.dmDeleted);
  const by = sameValue(deleted.map((c) => c.dmDeletedBy));
  const at = deleted.find((c) => c.dmDeletedAt)?.dmDeletedAt;
  return [by ? ` by <@${by}>` : "", at ? ` <t:${unix(at)}:R>` : ""].join("");
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The response tells the mod where the server's DM setting lives. */
function notSentText(
  cause: NotSentCause | null,
  actionType: ActionType,
): string {
  const why = notSentWhy(cause, actionType) ?? "";
  return cause === "guild_default"
    ? `${capitalize(why)} in \`/settings\``
    : why;
}

/**
 * Status lines under the reason come only from this view, so a rebuild can
 * tell them apart from the notes and render them afresh.
 */
const STATUS_LINE_PATTERNS = [
  /^Also included your server's \w+ message$/,
  /^DMs? (failed|not sent|deleted)\b/,
  /^\d+ DMs deleted\b/,
  /^\d+ (deleted|failed|not sent)\b/,
  /^No DMs (left|sent) · /,
  /^(\w+ )?DMs are off in /,
  /^mod log (not )?updated$/,
  /^DMs? (not )?updated\b/,
  /^Couldn't update the DMs?:/,
  /^Updated \d+ of \d+ DMs;/,
];

const LEADING_EMOJI = /^<a?:\w+:\d+> /;

function isStatusLine(line: string): boolean {
  if (!line.startsWith("-# ")) {
    return false;
  }
  const bare = line.slice(3).replace(LEADING_EMOJI, "");
  return STATUS_LINE_PATTERNS.some((pattern) => pattern.test(bare));
}

/** Discord may drop trailing spaces or carriage returns from posted text. */
function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd();
}

/** "Template `!spam`", or the no-shortcut variant. */
export function templateNote(template: TemplateRef): string {
  return template.shortcut
    ? `Template \`!${template.shortcut}\``
    : "Used a template (no shortcut)";
}

export function unknownShortcutNote(
  shortcut: string,
  emojis: Pick<ModerationActionEmojis, "warning">,
  dmSent: boolean,
): string {
  const dm = dmSent ? " and DMed like that" : "";
  const fix = dmSent
    ? "Fix it with Edit reason; you can update the DM there too."
    : "Fix it with Edit reason.";
  return withEmoji(
    emojis.warning,
    `No template \`!${shortcut}\`, so the text was used as typed${dm}. ${fix}`,
  );
}

export function editedNote(userId: string, at: Date, suffix = ""): string {
  return `Edited by <@${userId}> <t:${unix(at)}:R>${suffix}`;
}

function isNote(cases: ModerationCase[]): boolean {
  return cases[0]?.actionType === ActionType.Note;
}

function reasonBodyOf(cases: ModerationCase[]): string {
  return cases[0]?.reason?.value ?? "-# No reason given";
}

interface ReasonDelivery {
  heading: string;
  /** `-#` lines about the DM, rendered after the notes. */
  status: string[];
  /** Cases with a DM that Delete DM can still remove. */
  live: number;
}

interface DeliveryInput {
  cases: ModerationCase[];
  emojis: ModerationActionEmojis;
  dmTextIncluded: boolean;
  dmOverride?: string | null;
  dmSuffix?: string;
}

function reasonDelivery(input: DeliveryInput): ReasonDelivery {
  const { cases, emojis } = input;
  const dmCases = cases.filter((c) => actionTypeSupportsDM(c.actionType));
  if (dmCases.length === 0) {
    const heading = isNote(cases)
      ? `**${withEmoji(emojis.reason, "Note")}** · mods only`
      : reasonHeading(emojis, { sent: false });
    return { heading, status: [], live: 0 };
  }

  const actionType = dmCases[0].actionType;
  const states = dmCases.map(caseDmState);
  const total = dmCases.length;
  const live = states.filter((s) => s.kind === "live").length;
  const deleted = states.filter((s) => s.kind === "deleted").length;
  const failed = states.filter((s) => s.kind === "failed");
  const notSent = states.filter((s) => s.kind === "not_sent");
  const failReason = sameValue(failed.map((s) => s.reason));
  const notSentCause = sameValue(notSent.map((s) => s.cause));
  const suffix = (input.dmSuffix ?? "").replace(/^ · /, "");

  let heading: string;
  let cause: string | null = null;
  if (live > 0) {
    let to: string;
    if (total === 1) {
      to = escapeMarkdown(dmCases[0].userTag);
    } else if (live === total) {
      to = `${total} users`;
    } else {
      to = `${live} of ${total} users`;
    }
    heading = reasonHeading(emojis, { sent: true, to });

    const others: string[] = [];
    if (deleted > 0) {
      others.push(`${deleted} deleted${deletedBy(dmCases)}`);
    }
    if (failed.length > 0) {
      others.push(`${failed.length} failed`);
    }
    if (notSent.length > 0) {
      others.push(`${notSent.length} not sent`);
    }
    cause = others.length > 0 ? others.join(" · ") : null;
  } else {
    heading = reasonHeading(emojis, { sent: false });
    if (total === 1) {
      const [state] = states;
      if (state.kind === "failed") {
        cause = `DM failed: ${dmFailureText(state.reason)}`;
      } else if (state.kind === "not_sent" && state.cause === "guild_default") {
        cause = notSentText(state.cause, actionType);
      } else if (state.kind === "not_sent" && state.cause) {
        cause = `DM not sent: ${notSentText(state.cause, actionType)}`;
      } else if (state.kind === "deleted") {
        cause = `DM deleted${deletedBy(dmCases)}`;
      }
    } else if (deleted === total) {
      cause = `${total} DMs deleted${deletedBy(dmCases)}`;
    } else if (failed.length === total) {
      cause = `DMs failed for all ${total}${failReason ? `: ${dmFailureText(failReason)}` : ""}`;
    } else if (notSent.length === total) {
      if (notSentCause === "guild_default") {
        cause = notSentText(notSentCause, actionType);
      } else if (notSentCause) {
        cause = `DMs not sent: ${notSentText(notSentCause, actionType)}`;
      }
    } else {
      const parts: string[] = [];
      if (deleted > 0) {
        parts.push(`${deleted} deleted${deletedBy(dmCases)}`);
      }
      if (failed.length > 0) {
        parts.push(`${failed.length} failed`);
      }
      if (notSent.length > 0) {
        parts.push(`${notSent.length} not sent`);
      }
      cause = `${deleted > 0 ? "No DMs left" : "No DMs sent"} · ${parts.join(" · ")}`;
    }
  }

  const statusLine = [cause, suffix].filter(Boolean).join(" · ");
  const status = [
    statusLine,
    input.dmOverride ?? null,
    live > 0 && input.dmTextIncluded ? alsoIncludedLine(actionType) : null,
  ]
    .filter((line): line is string => !!line)
    .map((line) => `-# ${line}`);

  return { heading, status, live };
}

function attachmentsLine(
  urls: readonly string[],
  emojis: ModerationActionEmojis,
): string | null {
  if (urls.length === 0) {
    return null;
  }
  const links = truncateText(
    urls
      .map(
        (url) => `[${escapeMarkdown(getCleanFilename(url) || "file")}](${url})`,
      )
      .join(", "),
    ATTACHMENTS_MAX_LENGTH,
  );
  return withEmoji(emojis.attachment, links);
}

/** Attachment lines older responses appended to their notes line. */
function legacyAttachmentLines(
  cases: ModerationCase[],
  emojis: ModerationActionEmojis,
): string[] {
  const attachments = cases[0]?.attachments.filter(Boolean) ?? [];
  return [
    attachmentsLine(attachments, emojis),
    attachmentsLine(splitCaseAttachments(attachments).links, emojis),
  ].filter((line): line is string => line !== null);
}

/** The notes of an old-layout notes line, without its attachments. */
function parseLegacyNotes(
  content: string,
  attachmentLines: string[],
): string[] {
  return content.split("\n").flatMap((line) => {
    let note = line.replace(/^-# /, "");
    for (const attachments of attachmentLines) {
      if (note === attachments) {
        return [];
      }
      if (note.endsWith(` · ${attachments}`)) {
        note = note.slice(0, -` · ${attachments}`.length);
        break;
      }
    }
    return [note];
  });
}

export type ResponseMode = "buttons" | "confirmDeleteDm" | "expired" | "stale";

export interface ResponseBodyInput {
  /** The action's successful cases, as stored now. */
  cases: ModerationCase[];
  /** Proof of the action's cases, which share it. Oldest first. */
  proofs: CaseProof[];
  emojis: ModerationActionEmojis;
  reasonNotes: readonly string[];
  /** A status line under the reason about the DM, e.g. right after an edit. */
  dmOverride?: string | null;
  /** Appended to the DM status, e.g. " · mod log updated". */
  dmSuffix?: string;
  /** Filename of the attachment uploaded with this message, before its URL is saved. */
  upload?: string | null;
  /** The first case's mod log entry, linked from the stale and overflow lines. */
  modLogUrl?: string | null;
  savePrompt: boolean;
  mode: ResponseMode;
}

interface AssembleInput extends ResponseBodyInput {
  /** The DM also carried the server's extra DM text from `/settings`. */
  dmTextIncluded: boolean;
}

function button(
  label: string,
  customId: string,
  style: ButtonStyle,
  emoji: string,
  disabled: boolean,
): ButtonBuilder {
  const builder = new ButtonBuilder()
    .setLabel(label)
    .setCustomId(customId)
    .setStyle(style)
    .setDisabled(disabled);
  // A missing bot emoji comes back as "", which setEmoji rejects.
  if (emoji) {
    builder.setEmoji(emoji);
  }
  return builder;
}

function separator(): APIComponentInContainer {
  return new SeparatorBuilder()
    .setDivider(true)
    .setSpacing(SeparatorSpacingSize.Small)
    .toJSON();
}

function text(id: number, content: string): APITextDisplayComponent {
  return new TextDisplayBuilder().setId(id).setContent(content).toJSON();
}

function textLength(components: readonly unknown[]): number {
  let length = 0;
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") {
      return;
    }
    const component = node as {
      type?: number;
      content?: string;
      components?: unknown[];
    };
    if (component.type === ComponentType.TextDisplay && component.content) {
      length += component.content.length;
    }
    for (const child of component.components ?? []) {
      visit(child);
    }
  };
  components.forEach(visit);
  return length;
}

function savePromptLine(emojis: ModerationActionEmojis): string {
  return `-# ${withEmoji(emojis.tip, "This reason has been used 3 or more times in this server. Save it as a template to reuse it from autocomplete and reason forms.")}`;
}

function deleteDmConfirm(
  cases: ModerationCase[],
  live: number,
  encoded: string,
) {
  const liveCases = cases.filter(hasLiveDm);
  return buildDeleteDmConfirm({
    recipient: live === 1 ? { name: liveCases[0].userTag } : { count: live },
    confirmCustomId: buildResponseButtonId("dmDeleteConfirm", encoded),
    cancelCustomId: buildResponseButtonId("dmCancel", encoded),
  });
}

/** Edit reason and Delete DM under the reason, or the Delete DM confirm in their place. */
function reasonControls(
  body: AssembleInput,
  encoded: string | null,
  live: number,
  disabled: boolean,
): APIComponentInContainer[] {
  const { cases, emojis, mode } = body;
  if (!encoded) {
    return [];
  }

  if (mode === "confirmDeleteDm" && live > 0) {
    const confirm = deleteDmConfirm(cases, live, encoded);
    confirm.row.components[0]?.setId(liveDmButtonId(live));
    return [
      confirm.prompt.setId(ACTION_RESPONSE_IDS.confirm).toJSON(),
      confirm.row.setId(ACTION_RESPONSE_IDS.reasonRow).toJSON(),
    ];
  }

  const hasReason = !!cases[0]?.reason;
  const noun = isNote(cases) ? "note" : "reason";
  const row = new ActionRowBuilder<ButtonBuilder>()
    .setId(ACTION_RESPONSE_IDS.reasonRow)
    .addComponents(
      button(
        hasReason ? `Edit ${noun}` : `Add ${noun}`,
        buildResponseButtonId("edit", encoded),
        hasReason ? ButtonStyle.Secondary : ButtonStyle.Primary,
        emojis.message_edit,
        disabled,
      ),
    );
  if (live > 0) {
    row.addComponents(
      button(
        live > 1 ? `Delete ${live} DMs` : "Delete DM",
        buildResponseButtonId("dmDelete", encoded),
        ButtonStyle.Secondary,
        emojis.trash,
        disabled,
      ).setId(liveDmButtonId(live)),
    );
  }
  return [row.toJSON()];
}

function buildTail(
  body: AssembleInput,
  encoded: string | null,
  showPrompt: boolean,
  disabled: boolean,
): APIComponentInContainer[] {
  const { emojis } = body;
  if (!encoded) {
    return [separator(), text(ACTION_RESPONSE_IDS.footer, TOO_MANY_CASES_LINE)];
  }
  if (!showPrompt) {
    return [];
  }
  return [
    separator(),
    text(ACTION_RESPONSE_IDS.prompt, savePromptLine(emojis)),
    new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        button(
          "Save as template",
          buildResponseButtonId("save", encoded),
          ButtonStyle.Secondary,
          emojis.save,
          disabled,
        ),
      )
      .toJSON(),
  ];
}

function galleryUrls(
  proofs: readonly CaseProof[],
  upload: string | null | undefined,
): string[] {
  const urls = upload
    ? [
        `attachment://${upload}`,
        ...proofMediaUrls(proofs.filter((p) => p.source !== "action")),
      ]
    : proofMediaUrls(proofs);
  return urls.slice(0, GALLERY_MAX_ITEMS);
}

function proofGallery(urls: string[]): APIComponentInContainer | null {
  if (urls.length === 0) {
    return null;
  }
  return new MediaGalleryBuilder()
    .setId(ACTION_RESPONSE_IDS.media)
    .addItems(urls.map((url) => new MediaGalleryItemBuilder().setURL(url)))
    .toJSON();
}

function proofIntro(body: AssembleInput): string {
  const lines = [proofHeading(body.emojis)];
  if (body.cases.length > 1) {
    lines.push(`-# Added proof goes on all ${body.cases.length} cases`);
  }
  return lines.join("\n");
}

function overflowLine(count: number, modLogUrl: string | null): string {
  return modLogUrl
    ? `-# +${count} more on the mod log entry: ${modLogUrl}`
    : `-# +${count} more on the mod log entry`;
}

const OVERFLOW_LINE_MAX_LENGTH = overflowLine(
  999,
  "x".repeat(MESSAGE_URL_MAX_LENGTH),
).length;

/** Entries oldest first while they fit; the mod log entry holds the rest. */
function proofText(
  body: AssembleInput,
  hasGallery: boolean,
  maxLength: number,
): string {
  const { proofs, emojis } = body;
  const intro = proofIntro(body);
  if (proofs.length === 0) {
    return hasGallery ? intro : `${intro}\n${NO_PROOF_LINE}`;
  }

  const shown: string[] = [];
  let length = intro.length;
  for (const [index, proof] of proofs.entries()) {
    const entry = [
      proofEntryText(proof, emojis),
      ...proofFileLinks([proof]),
    ].join("\n");
    const remaining = proofs.length - index - 1;
    const room = maxLength - (remaining > 0 ? OVERFLOW_LINE_MAX_LENGTH + 1 : 0);
    if (length + 1 + entry.length > room) {
      break;
    }
    shown.push(entry);
    length += 1 + entry.length;
  }

  const hidden = proofs.length - shown.length;
  const lines = [intro, ...shown];
  if (hidden > 0) {
    lines.push(overflowLine(hidden, body.modLogUrl ?? null));
  }
  return lines.join("\n");
}

function terminalLine(
  mode: ResponseMode,
  modLogUrl: string | null,
): string | null {
  if (mode === "expired") {
    return EXPIRED_LINE;
  }
  if (mode === "stale") {
    return staleLine(modLogUrl);
  }
  return null;
}

/**
 * Header and details are given; everything else comes from the cases and
 * proof. The reason is never cut: the header's target list and the proof
 * entries give way to it.
 */
function assemble(
  accentColor: number | undefined,
  header: HeaderBuilder,
  details: APIComponentInContainer | null,
  body: AssembleInput,
): ContainerBuilder {
  const { cases, emojis, mode } = body;
  const caseIds = cases.map((c) => c.caseId);
  const encoded = encodeCaseIds(caseIds);
  const terminal = terminalLine(mode, body.modLogUrl ?? null);
  const disabled = terminal !== null;

  const delivery = reasonDelivery(body);
  const live = delivery.live;
  const controls = reasonControls(body, encoded, live, disabled);
  // Kept while confirming Delete DM, so Cancel can restore Save as template.
  const showPrompt = body.savePrompt && !!encoded && !!cases[0]?.reason;
  const tail = buildTail(body, encoded, showPrompt, disabled);
  const terminalComponents = terminal
    ? [separator(), text(ACTION_RESPONSE_IDS.status, terminal)]
    : [];

  // Expiry, staleness and the Delete DM confirm add text later without a re-render.
  const confirmPrompt =
    encoded && mode === "buttons" && live > 0
      ? textLength([deleteDmConfirm(cases, live, encoded).prompt.toJSON()])
      : 0;
  const reserve = terminal ? 0 : TERMINAL_LINE_MAX_LENGTH + confirmPrompt;

  const reasonCore = `${delivery.heading}\n${reasonBodyOf(cases)}`;
  const statusText = delivery.status.join("\n");
  const proofMin = proofIntro(body).length + 1 + OVERFLOW_LINE_MAX_LENGTH;
  const fixed =
    textLength([details, ...controls, ...tail, ...terminalComponents]) +
    reserve +
    reasonCore.length +
    (statusText ? statusText.length + 1 : 0) +
    proofMin;

  const notesRoom =
    MESSAGE_TEXT_MAX_LENGTH - fixed - textLength([header(0)]) - 1;
  const notes = body.reasonNotes.map((n) => `-# ${n}`).join("\n");
  const notesText =
    notes && notesRoom > 0 ? truncateText(notes, notesRoom) : "";
  const reasonText = [reasonCore, notesText, statusText]
    .filter(Boolean)
    .join("\n");

  const headerRoom =
    MESSAGE_TEXT_MAX_LENGTH -
    (fixed - reasonCore.length - (statusText ? statusText.length + 1 : 0)) -
    reasonText.length;
  const headerComponent = header(Math.min(HEADER_MAX_LENGTH, headerRoom));

  const urls = galleryUrls(body.proofs, body.upload);
  const gallery = proofGallery(urls);
  const proofRoom =
    MESSAGE_TEXT_MAX_LENGTH -
    reserve -
    textLength([
      headerComponent,
      details,
      ...controls,
      ...tail,
      ...terminalComponents,
    ]) -
    reasonText.length;
  const proofContent = text(
    proofTextId(body.proofs),
    proofText(body, gallery !== null, proofRoom),
  );
  const proofSection = encoded
    ? new SectionBuilder()
        .setId(ACTION_RESPONSE_IDS.proofSection)
        .addTextDisplayComponents(new TextDisplayBuilder(proofContent))
        .setButtonAccessory(addProofButton(caseIds, emojis, { disabled }))
        .toJSON()
    : proofContent;

  const components = [
    headerComponent,
    details,
    separator(),
    text(ACTION_RESPONSE_IDS.reason, reasonText),
    ...controls,
    separator(),
    proofSection,
    gallery,
    ...tail,
    ...terminalComponents,
  ].filter((c): c is APIComponentInContainer => c !== null);

  return new ContainerBuilder({
    accent_color: accentColor,
    components,
  });
}

export interface ActionResponseMessage {
  components: ContainerBuilder[];
  flags: MessageFlags.IsComponentsV2;
  allowedMentions: { parse: [] };
}

function message(container: ContainerBuilder): ActionResponseMessage {
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

export interface ActionResultInput {
  actionType: ActionType;
  executor: User;
  targets: ModerationTarget[];
  results: Result<ModerationCase, string>[];
  guildConfig: GuildConfig;
  action: ModerationAction;
  emojis: ModerationActionEmojis;
  reasonNotes?: readonly string[];
  /** The reason is used often and isn't a template yet. */
  savePrompt?: boolean;
  /** Filename of the proof file re-uploaded with the response. */
  upload?: string | null;
  /** Proof of the action's cases; the action-time entry, if any. */
  proofs?: CaseProof[];
  now?: Date;
}

/** The slash command's response: one container, with buttons for 15 minutes. */
export function buildActionResultMessage(
  input: ActionResultInput,
): ActionResponseMessage {
  const now = input.now ?? new Date();
  const entries: TargetResult[] = input.targets.map((target, index) => ({
    target,
    result: input.results[index],
  }));
  const cases = entries.flatMap((e) => (e.result.ok ? [e.result.val] : []));
  const failed = entries.length - cases.length;

  let accent: number;
  if (cases.length === 0) {
    accent = Color.Error;
  } else if (failed > 0) {
    accent = Color.Warning;
  } else {
    accent = getActionTypeColor(input.actionType) ?? Color.Success;
  }

  const header: HeaderBuilder = (maxLength) =>
    buildHeader(
      input.actionType,
      input.executor,
      entries,
      input.emojis,
      now,
      maxLength,
    ).toJSON();
  if (cases.length === 0) {
    return message(
      new ContainerBuilder({
        accent_color: accent,
        components: [header(HEADER_MAX_LENGTH)],
      }),
    );
  }

  const details = buildDetails(input, now);
  const dmText = guildDmText(input.actionType, input.guildConfig);
  return message(
    assemble(accent, header, details?.toJSON() ?? null, {
      cases,
      proofs: input.proofs ?? [],
      emojis: input.emojis,
      reasonNotes: input.reasonNotes ?? [],
      dmTextIncluded: !!dmText?.trim(),
      savePrompt:
        (input.savePrompt ?? false) && input.actionType !== ActionType.Note,
      upload: input.upload,
      mode: "buttons",
    }),
  );
}

function findContainer(
  components: readonly APIMessageTopLevelComponent[],
): APIContainerComponent | null {
  return (
    (components.find((c) => c.type === ComponentType.Container) as
      | APIContainerComponent
      | undefined) ?? null
  );
}

function findById(
  container: APIContainerComponent | null,
  id: number,
): APIComponentInContainer | null {
  return container?.components.find((c) => c.id === id) ?? null;
}

/** A text display by id, at the top level or inside a section. */
function findTextById(
  container: APIContainerComponent | null,
  id: number,
): string | null {
  for (const component of container?.components ?? []) {
    if (component.type === ComponentType.TextDisplay && component.id === id) {
      return component.content;
    }
    if (component.type === ComponentType.Section) {
      const nested = component.components.find((c) => c.id === id);
      if (nested) {
        return nested.content;
      }
    }
  }
  return null;
}

/**
 * Copies a header component without Discord's extra fields, such as the ids
 * it assigned to nested components or the media's proxy URL.
 */
function copyHeader(
  component: APIComponentInContainer,
  maxLength: number,
): APIComponentInContainer | null {
  const id = ACTION_RESPONSE_IDS.header;
  if (component.type === ComponentType.TextDisplay) {
    return text(id, fitHeaderText(component.content, maxLength));
  }

  if (component.type === ComponentType.Section) {
    const section = new SectionBuilder()
      .setId(id)
      .addTextDisplayComponents(
        component.components.map((c) =>
          new TextDisplayBuilder().setContent(c.content),
        ),
      );
    const accessory = component.accessory;
    if (accessory.type === ComponentType.Thumbnail) {
      section.setThumbnailAccessory(
        new ThumbnailBuilder().setURL(accessory.media.url),
      );
      return section.toJSON();
    }
    return text(id, component.components.map((c) => c.content).join("\n"));
  }

  return null;
}

function fallbackHeader(
  cases: ModerationCase[],
  emojis: ModerationActionEmojis,
): APIComponentInContainer {
  const type = cases[0]?.actionType ?? ActionType.Ban;
  const title = withEmoji(
    emojis[getActionTypeBotEmoji(type)],
    verbs(type).done.replace(/ of$| to$/, ""),
  );
  return text(
    ACTION_RESPONSE_IDS.header,
    `### ${title}\n-# ${formatCaseRefs(cases.map((c) => c.caseId))}`,
  );
}

const DURATION_LINE = /· ends <t:\d+:f>$/;

/**
 * The posted duration line. Responses from before the DM section also showed
 * the extra DM text here.
 */
function postedDetails(component: APIComponentInContainer | null): {
  details: APIComponentInContainer | null;
  legacyDmText: boolean;
} {
  const content = textOf(component);
  if (content === null) {
    return { details: null, legacyDmText: false };
  }
  const lines = content.split("\n");
  const duration = lines.filter((l) => DURATION_LINE.test(l));
  return {
    details: duration.length
      ? text(ACTION_RESPONSE_IDS.details, duration.join("\n"))
      : null,
    legacyDmText: lines.some((l) => l.startsWith("> ")),
  };
}

function textOf(component: APIComponentInContainer | null): string | null {
  return component?.type === ComponentType.TextDisplay
    ? component.content
    : null;
}

interface PostedReason {
  /** null when the reason changed since it was posted. */
  notes: string[] | null;
  dmTextIncluded: boolean;
}

/** Notes and DM text of a response posted before the reason block. */
function legacyPostedReason(
  container: APIContainerComponent | null,
  body: { cases: ModerationCase[]; emojis: ModerationActionEmojis },
  legacyDmText: boolean,
): PostedReason {
  const dmLine = findTextById(container, ACTION_RESPONSE_IDS.dm);
  let dmTextIncluded = legacyDmText;
  if (dmLine?.startsWith("**DM sent**")) {
    const lines = dmLine.split("\n");
    const reasonQuoted = lines[0].endsWith("what they received:") ? 1 : 0;
    dmTextIncluded = lines.length > 1 + reasonQuoted;
  }

  const postedReason = findTextById(container, ACTION_RESPONSE_IDS.reason);
  const postedNotes = findTextById(container, ACTION_RESPONSE_IDS.reasonNotes);
  const fresh = normalizeText(
    body.cases[0]?.reason?.value ?? "-# No reason given",
  );
  const old =
    postedReason === null
      ? null
      : normalizeText(postedReason.slice(postedReason.indexOf("\n") + 1));
  // A reason cut to fit can only be compared by its uncut start.
  const unchanged =
    old !== null &&
    (old === fresh ||
      (old.endsWith(ELLIPSIS) &&
        fresh.startsWith(old.slice(0, -ELLIPSIS.length).trimEnd())));
  if (!unchanged) {
    return { notes: null, dmTextIncluded };
  }
  return {
    notes: postedNotes
      ? parseLegacyNotes(
          postedNotes,
          legacyAttachmentLines(body.cases, body.emojis),
        )
      : [],
    dmTextIncluded,
  };
}

function postedReason(
  container: APIContainerComponent | null,
  body: { cases: ModerationCase[]; emojis: ModerationActionEmojis },
  legacyDmText: boolean,
): PostedReason {
  if (
    findById(container, ACTION_RESPONSE_IDS.reasonRow) === null &&
    findProofText(container) === null
  ) {
    return legacyPostedReason(container, body, legacyDmText);
  }

  const content = findTextById(container, ACTION_RESPONSE_IDS.reason) ?? "";
  const rest = normalizeText(content.slice(content.indexOf("\n") + 1));
  const tail = rest.split("\n");
  const dmTextIncluded = tail.some(
    (line) => isStatusLine(line) && line.startsWith("-# Also included"),
  );

  const fresh = normalizeText(reasonBodyOf(body.cases));
  let noteLines: string[];
  if (rest === fresh) {
    noteLines = [];
  } else if (rest.startsWith(`${fresh}\n`)) {
    noteLines = rest.slice(fresh.length + 1).split("\n");
  } else {
    return { notes: null, dmTextIncluded };
  }

  return {
    notes: noteLines
      .filter((line) => line !== "" && !isStatusLine(line))
      .map((line) => line.replace(/^-# /, "")),
    dmTextIncluded,
  };
}

function findProofText(
  container: APIContainerComponent | null,
): APITextDisplayComponent | null {
  for (const component of container?.components ?? []) {
    if (
      component.type === ComponentType.TextDisplay &&
      isProofTextId(component.id)
    ) {
      return component;
    }
    if (component.type === ComponentType.Section) {
      const nested = component.components.find((c) => isProofTextId(c.id));
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

/** The posted proof text, or null on responses from before the proof section. */
export function postedProofText(
  posted: readonly APIMessageTopLevelComponent[],
): string | null {
  return findProofText(findContainer(posted))?.content ?? null;
}

interface PostedButton {
  id?: number;
  custom_id?: string;
}

/**
 * Live DMs the posted response offers to delete. Responses from before the
 * count was carried in the button id only say whether one is offered.
 */
function postedLiveDms(container: APIContainerComponent): number | "some" {
  const buttons = container.components.flatMap((c): PostedButton[] => {
    if (c.type === ComponentType.ActionRow) {
      return c.components as PostedButton[];
    }
    if (c.type === ComponentType.Section) {
      return [c.accessory as PostedButton];
    }
    return [];
  });
  for (const button of buttons) {
    const kind = parseResponseButtonId(button.custom_id ?? "")?.kind;
    if (kind !== "dmDelete" && kind !== "dmDeleteConfirm") {
      continue;
    }
    const id = button.id ?? 0;
    if (
      id >= LIVE_DM_BUTTON_ID_BASE &&
      id <= LIVE_DM_BUTTON_ID_BASE + LIVE_DM_BUTTON_ID_MAX_COUNT
    ) {
      return id - LIVE_DM_BUTTON_ID_BASE;
    }
    return "some";
  }
  return 0;
}

/**
 * Whether the cases changed since the response was last rendered: a
 * different reason, a different number of proof entries, or a DM deleted.
 * Responses from before the proof section skip the proof comparison.
 */
export function postedResponseDiffers(
  posted: readonly APIMessageTopLevelComponent[],
  current: {
    cases: ModerationCase[];
    proofs: readonly CaseProof[];
    emojis: ModerationActionEmojis;
  },
): boolean {
  const container = findContainer(posted);
  if (!container || current.cases.length === 0) {
    return false;
  }

  const { legacyDmText } = postedDetails(
    findById(container, ACTION_RESPONSE_IDS.details),
  );
  // The response shows one reason for all its cases, which every case must still have.
  const reasonChanged = current.cases.some(
    (c) =>
      postedReason(
        container,
        { cases: [c], emojis: current.emojis },
        legacyDmText,
      ).notes === null,
  );
  if (reasonChanged) {
    return true;
  }

  const proofText = findProofText(container);
  if (proofText && proofText.id !== proofTextId(current.proofs)) {
    return true;
  }

  const live = current.cases.filter(hasLiveDm).length;
  const shown = postedLiveDms(container);
  return shown === "some" ? live === 0 : shown !== live;
}

/** Whether the posted response offers Save as template, including while confirming Delete DM. */
export function hasSavePrompt(
  components: readonly APIMessageTopLevelComponent[],
): boolean {
  return (
    findById(findContainer(components), ACTION_RESPONSE_IDS.prompt) !== null
  );
}

/**
 * Rebuilds a posted response from reloaded cases and proof. The header,
 * details and whether the DM carried the server's DM text come from the
 * posted message. Without new reasonNotes, the old notes stay while the
 * reason is unchanged; a reason changed elsewhere gets an "Edited by" note
 * from the case instead.
 */
export function rebuildActionResponse(
  posted: readonly APIMessageTopLevelComponent[],
  body: Omit<ResponseBodyInput, "reasonNotes"> & {
    reasonNotes?: readonly string[];
  },
): ActionResponseMessage {
  const container = findContainer(posted);
  const postedHeader = findById(container, ACTION_RESPONSE_IDS.header);
  const header: HeaderBuilder = (maxLength) =>
    (postedHeader && copyHeader(postedHeader, maxLength)) ??
    fallbackHeader(body.cases, body.emojis);
  const { details, legacyDmText } = postedDetails(
    findById(container, ACTION_RESPONSE_IDS.details),
  );

  const previous = postedReason(container, body, legacyDmText);
  let reasonNotes = body.reasonNotes;
  if (!reasonNotes) {
    if (previous.notes) {
      reasonNotes = previous.notes;
    } else {
      const first = body.cases[0];
      reasonNotes =
        first?.reasonSetBy && first.reasonSetAt
          ? [editedNote(first.reasonSetBy, first.reasonSetAt)]
          : [];
    }
  }

  return message(
    assemble(container?.accent_color ?? undefined, header, details, {
      ...body,
      reasonNotes,
      dmTextIncluded: previous.dmTextIncluded,
    }),
  );
}

type RawComponent = Record<string, unknown> & { type: number; id?: number };

function withId<T extends Record<string, unknown>>(
  source: RawComponent,
  copy: T,
): T & { id?: number } {
  return source.id === undefined ? copy : { ...copy, id: source.id };
}

/** The fields a button needs to be sent again, disabled. */
function disabledButton(source: RawComponent): RawComponent {
  const copy: RawComponent = { type: source.type, style: source.style };
  for (const key of ["label", "emoji", "custom_id", "url", "sku_id"]) {
    if (source[key] !== undefined) {
      copy[key] = source[key];
    }
  }
  return withId(source, { ...copy, disabled: true });
}

function mediaOf(source: unknown): { url: string } {
  return { url: (source as { url: string }).url };
}

/**
 * A posted component sent again with its buttons and selects disabled,
 * without Discord's extra fields such as media proxy URLs and sizes.
 */
function disabledCopy(source: RawComponent): RawComponent | null {
  switch (source.type) {
    case ComponentType.TextDisplay:
      return withId(source, { type: source.type, content: source.content });
    case ComponentType.Separator:
      return withId(source, {
        type: source.type,
        divider: source.divider,
        spacing: source.spacing,
      });
    case ComponentType.MediaGallery:
      return withId(source, {
        type: source.type,
        items: (source.items as RawComponent[]).map((item) => ({
          media: mediaOf(item.media),
          ...(item.description ? { description: item.description } : {}),
          ...(item.spoiler ? { spoiler: item.spoiler } : {}),
        })),
      });
    case ComponentType.Section: {
      const accessory = source.accessory as RawComponent;
      return withId(source, {
        type: source.type,
        components: (source.components as RawComponent[]).flatMap(
          (c) => disabledCopy(c) ?? [],
        ),
        accessory:
          accessory.type === ComponentType.Button
            ? disabledButton(accessory)
            : withId(accessory, {
                type: accessory.type,
                media: mediaOf(accessory.media),
              }),
      });
    }
    case ComponentType.ActionRow:
      return withId(source, {
        type: source.type,
        components: (source.components as RawComponent[]).map((c) => {
          if (c.type === ComponentType.Button) {
            return disabledButton(c);
          }
          return { ...c, disabled: true };
        }),
      });
    default:
      return null;
  }
}

function terminalLineOf(component: APIComponentInContainer): string | null {
  if (component.type !== ComponentType.TextDisplay) {
    return null;
  }
  const { content } = component;
  return content === EXPIRED_LINE || content.startsWith(STALE_PREFIX)
    ? content
    : null;
}

function withTerminalLine(
  posted: readonly APIMessageTopLevelComponent[],
  line: string,
): ActionResponseMessage | null {
  const container = findContainer(posted);
  if (!container || showsExpiredLine(posted)) {
    return null;
  }

  const hasButtons = container.components.some(
    (c) =>
      c.type === ComponentType.ActionRow ||
      (c.type === ComponentType.Section &&
        c.accessory.type === ComponentType.Button),
  );
  if (!hasButtons) {
    return null;
  }

  const kept = container.components.flatMap(
    (c) => disabledCopy(c as unknown as RawComponent) ?? [],
  ) as unknown as APIComponentInContainer[];
  if (kept.at(-1)?.type !== ComponentType.Separator) {
    kept.push(separator());
  }

  return message(
    new ContainerBuilder({
      accent_color: container.accent_color ?? undefined,
      components: [...kept, text(ACTION_RESPONSE_IDS.status, line)],
    }),
  );
}

/**
 * The posted response with every button disabled and the expired line
 * appended. null when it already ends in the expired or stale line.
 */
export function expireActionResponse(
  posted: readonly APIMessageTopLevelComponent[],
): ActionResponseMessage | null {
  return withTerminalLine(posted, EXPIRED_LINE);
}

/** Like expiry, for a case changed elsewhere while the response was live. */
export function staleActionResponse(
  posted: readonly APIMessageTopLevelComponent[],
  modLogUrl: string | null,
): ActionResponseMessage | null {
  return withTerminalLine(posted, staleLine(modLogUrl));
}

/** True once the response ends in the expired or stale line; its buttons are done. */
export function showsExpiredLine(
  posted: readonly APIMessageTopLevelComponent[],
): boolean {
  return (findContainer(posted)?.components ?? []).some(
    (c) => terminalLineOf(c) !== null,
  );
}

const STALE_URL = /Up-to-date entry: (\S+)$/;

/** The stale line's mod log URL, null without one, or undefined when not stale. */
export function postedStaleUrl(
  posted: readonly APIMessageTopLevelComponent[],
): string | null | undefined {
  for (const component of findContainer(posted)?.components ?? []) {
    const line = terminalLineOf(component);
    if (line?.startsWith(STALE_PREFIX)) {
      return STALE_URL.exec(line)?.[1] ?? null;
    }
  }
  return undefined;
}
