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
import {
  guildDmText,
  guildDmTextSetting,
} from "@/features/moderation/shared/application/DMNotificationService";
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
import { quoteLines } from "@/features/moderation/shared/presentation/reasonFields";
import {
  getActionTypeBotEmoji,
  getActionTypeColor,
} from "@/features/moderation/shared/presentation/views/ActionTypeFormatter";
import {
  buildDeleteDmConfirm,
  hasLiveDm,
} from "@/features/moderation/shared/presentation/views/ModLogMessageView";
import dayjs from "@/shared/domain/dayjs";
import type { GuildConfig } from "@/shared/domain/entities/GuildConfig";
import Color from "@/utils/colors";
import { ELLIPSIS, truncateText } from "@/utils/truncateText";
import { getCleanFilename } from "@/utils/url";

import {
  buildResponseButtonId,
  encodeCaseIds,
  toCaseRuns,
} from "../response/customIds";

export const MODERATION_ACTION_EMOJIS = [
  ...ActionTypeBotEmojis,
  "success",
  "fail",
  "message",
  "duration",
  "attachment",
  "warning",
  "tip",
  "save",
  "trash",
  "message_edit",
] as const satisfies readonly BotEmojiNameType[];

export type ModerationActionEmojis = EmojiMap<typeof MODERATION_ACTION_EMOJIS>;

/**
 * Stable component ids. A button click rebuilds the response from reloaded
 * cases but copies `header`, `details` and the DM quote from the clicked
 * message, since failed-target errors, the typed duration and what the DM
 * held aren't stored anywhere. Text displays keep their id whether they sit
 * in a section or, once its button is gone, at the top level.
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
} as const;

export const RESPONSE_WINDOW_MS = 15 * 60 * 1000;

export const EXPIRED_LINE =
  "-# Buttons expired after 15 minutes. Later changes: the mod log entry or `/reason`.";

export const EXPIRED_CLICK_MESSAGE =
  "These buttons expired after 15 minutes. Change the reason from the mod log entry or with `/reason`.";

const TOO_MANY_CASES_LINE =
  "-# These cases are too spread out for buttons. Change them from the mod log entries or with `/reason`.";

const DM_RECEIVED = "what they received:";
const DM_SETTINGS_LINE =
  "-# Extra DM text is set in `/settings` → Moderation → DMs sent to members";

/** Discord's cap on text across all text displays in one message. */
const MESSAGE_TEXT_MAX_LENGTH = 4000;
const HEADER_MAX_LENGTH = 1800;
const TARGET_ERROR_MAX_LENGTH = 120;
const DM_TEXT_MAX_LENGTH = 500;
const DM_PREVIEW_LENGTH = 60;
const ATTACHMENTS_MAX_LENGTH = 400;

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
      ? `${withEmoji(emojis.success, chip)}\n-# ↳ DM failed: ${DM_FAILURE_TEXT[failure]}`
      : withEmoji(emojis.success, chip);
  }

  const error = truncateText(result.val, TARGET_ERROR_MAX_LENGTH);
  return `${withEmoji(emojis.fail, chip)}\n-# ↳ Couldn't ${failVerb} ${escapeMarkdown(target.user.username)}: ${error}`;
}

function buildHeader(
  actionType: ActionType,
  executor: User,
  entries: TargetResult[],
  emojis: ModerationActionEmojis,
  now: Date,
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
  const budget = HEADER_MAX_LENGTH - head.length - by.length - 1;
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

const DM_FAILURE_TEXT: Record<DMFailureReason, string> = {
  user_blocked: "they blocked sushii",
  user_privacy: "they have server DMs off or share no server with sushii",
  user_cannot_receive: "they have DMs off or blocked sushii",
  unknown: "Discord returned an error",
};

type DmState =
  | { kind: "live" }
  | { kind: "deleted" }
  | { kind: "failed"; reason: DMFailureReason }
  | { kind: "not_sent"; why: string | null };

function dmState(moderationCase: ModerationCase): DmState {
  if (moderationCase.dmDeleted) {
    return { kind: "deleted" };
  }
  if (hasLiveDm(moderationCase)) {
    return { kind: "live" };
  }
  if (moderationCase.dmFailed || moderationCase.dmFailureReason) {
    return {
      kind: "failed",
      reason:
        moderationCase.dmFailureReason ??
        moderationCase.dmResult?.failureReason ??
        "unknown",
    };
  }
  if (moderationCase.dmNotAttemptedReason === "user_not_in_guild") {
    return { kind: "not_sent", why: "not in the server" };
  }
  switch (moderationCase.dmIntentSource) {
    case "executor_no":
      return { kind: "not_sent", why: "you chose no DM" };
    case "guild_default":
      return { kind: "not_sent", why: "off in `/settings`" };
    default:
      return { kind: "not_sent", why: null };
  }
}

function dmFailureOf(moderationCase: ModerationCase): DMFailureReason | null {
  const state = dmState(moderationCase);
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

/** The reason block as rendered for these cases, before truncation. */
function reasonContent(cases: ModerationCase[], maxLength: number): string {
  const heading = `**${isNote(cases) ? "Note" : "Reason"}**\n`;
  const reason = cases[0]?.reason?.value;
  const body = reason
    ? truncateText(reason, Math.max(1, maxLength - heading.length))
    : "-# No reason given";
  return heading + body;
}

/** Everything after the heading line, which older responses rendered with an emoji. */
function reasonBody(content: string): string {
  return content.slice(content.indexOf("\n") + 1);
}

function attachmentsLine(
  cases: ModerationCase[],
  emojis: ModerationActionEmojis,
): string | null {
  const attachments = cases[0]?.attachments.filter(Boolean) ?? [];
  if (attachments.length === 0) {
    return null;
  }
  const links = truncateText(
    attachments
      .map(
        (url) => `[${escapeMarkdown(getCleanFilename(url) || "file")}](${url})`,
      )
      .join(", "),
    ATTACHMENTS_MAX_LENGTH,
  );
  return withEmoji(emojis.attachment, links);
}

function notesContent(
  notes: readonly string[],
  attachments: string | null,
): string | null {
  const lines = [...notes];
  if (attachments) {
    lines[0] = lines.length > 0 ? `${lines[0]} · ${attachments}` : attachments;
  }
  return lines.length > 0 ? lines.map((l) => `-# ${l}`).join("\n") : null;
}

/** The notes of a posted notes line, without the attachments, which come from the case. */
function parseNotes(content: string, attachments: string | null): string[] {
  return content.split("\n").flatMap((line) => {
    let note = line.replace(/^-# /, "");
    if (attachments) {
      if (note === attachments) {
        return [];
      }
      if (note.endsWith(` · ${attachments}`)) {
        note = note.slice(0, -` · ${attachments}`.length);
      }
    }
    return [note];
  });
}

/** What the DM recipients received, as rendered in the DM section. */
interface DmContent {
  /** Quoted first line of the reason, or null when the DM had no reason. */
  reasonLine: string | null;
  /** The quoted extra DM text from `/settings`. */
  configured: string | null;
}

function dmReasonLine(cases: ModerationCase[]): string | null {
  const reason = cases[0]?.reason?.value;
  if (!reason) {
    return null;
  }
  const firstLine = reason.split("\n").find((l) => l.trim()) ?? "";
  const cut =
    firstLine.trim() !== reason.trim() && firstLine.length <= DM_PREVIEW_LENGTH
      ? `${firstLine}${ELLIPSIS}`
      : truncateText(firstLine, DM_PREVIEW_LENGTH);
  return `> ${escapeMarkdown(cut, {
    heading: true,
    bulletedList: true,
    numberedList: true,
    maskedLink: true,
  })}`;
}

function dmContentFor(
  cases: ModerationCase[],
  configured: string | null,
): DmContent {
  return {
    reasonLine: dmReasonLine(cases),
    configured: configured ? quoteLines(configured, DM_TEXT_MAX_LENGTH) : null,
  };
}

export type ResponseMode = "buttons" | "confirmDeleteDm" | "expired";

export interface ResponseBodyInput {
  /** The action's successful cases, as stored now. */
  cases: ModerationCase[];
  emojis: ModerationActionEmojis;
  reasonNotes: readonly string[];
  /** A status line under a sent DM, e.g. right after an edit. */
  dmOverride?: string | null;
  /** Appended to the DM status, e.g. " · mod log updated". */
  dmSuffix?: string;
  /** The DMs were edited to the cases' current reason. */
  dmReasonUpdated?: boolean;
  savePrompt: boolean;
  mode: ResponseMode;
}

interface AssembleInput extends ResponseBodyInput {
  dm: DmContent;
}

function button(
  label: string,
  customId: string,
  style: ButtonStyle,
  emoji: string,
): ButtonBuilder {
  const builder = new ButtonBuilder()
    .setLabel(label)
    .setCustomId(customId)
    .setStyle(style);
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

/** A section with the button, or its text displays on their own when there's no button. */
function sectionOrTexts(
  id: number,
  texts: APITextDisplayComponent[],
  accessory: ButtonBuilder | null,
): APIComponentInContainer[] {
  if (!accessory) {
    return texts;
  }
  return [
    new SectionBuilder()
      .setId(id)
      .addTextDisplayComponents(texts.map((t) => new TextDisplayBuilder(t)))
      .setButtonAccessory(accessory)
      .toJSON(),
  ];
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

interface DmPart {
  /** Text displays, in order: the DM line, the extra DM text and the small footer. */
  texts: APITextDisplayComponent[];
  /** Delete DM applies. */
  live: number;
}

/** The DM part from the stored DM fields, or null for actions that never DM. */
function buildDmPart(input: AssembleInput): DmPart | null {
  const { cases } = input;
  const dmCases = cases.filter((c) => actionTypeSupportsDM(c.actionType));
  if (dmCases.length === 0) {
    return null;
  }

  const states = dmCases.map(dmState);
  const total = dmCases.length;
  const live = states.filter((s) => s.kind === "live").length;
  const deleted = states.filter((s) => s.kind === "deleted").length;
  const failed = states.filter((s) => s.kind === "failed");
  const notSent = states.filter((s) => s.kind === "not_sent");
  const failReason = sameValue(failed.map((s) => s.reason));
  const notSentWhy = sameValue(notSent.map((s) => s.why));
  const suffix = input.dmSuffix ?? "";
  const override = input.dmOverride ?? null;

  if (live > 0) {
    const to = total > 1 ? ` to ${live} of ${total}` : "";
    const { reasonLine, configured } = input.dm;
    const line = [
      reasonLine
        ? `**DM sent**${to} · ${DM_RECEIVED}\n${reasonLine}`
        : `**DM sent**${to} · no reason was included`,
      configured,
    ]
      .filter(Boolean)
      .join("\n");

    const others: string[] = [];
    if (deleted > 0) {
      others.push(`${deleted} deleted${deletedBy(dmCases)}`);
    }
    if (notSent.length > 0) {
      others.push(`${notSent.length} not sent`);
    }
    const status = [override, others.join(" · "), suffix.replace(/^ · /, "")]
      .filter(Boolean)
      .join(" · ");
    const hint = guildDmTextSetting(dmCases[0].actionType)
      ? DM_SETTINGS_LINE
      : null;
    const footer = [status ? `-# ${status}` : null, hint]
      .filter(Boolean)
      .join("\n");

    const texts = [text(ACTION_RESPONSE_IDS.dm, line)];
    if (footer) {
      texts.push(text(ACTION_RESPONSE_IDS.dmFooter, footer));
    }
    return { texts, live };
  }

  let line: string;
  if (total === 1) {
    const [state] = states;
    if (state.kind === "failed") {
      line = `**DM failed** · ${DM_FAILURE_TEXT[state.reason]}`;
    } else if (state.kind === "not_sent" && state.why) {
      line = `**DM not sent** · ${state.why}`;
    } else if (state.kind === "not_sent") {
      line = "**DM not sent**";
    } else {
      line = `**DM deleted**${deletedBy(dmCases)}`;
    }
  } else if (deleted === total) {
    line = `**${total} DMs deleted**${deletedBy(dmCases)}`;
  } else if (failed.length === total) {
    line = `**DMs failed** for all ${total}${failReason ? ` · ${DM_FAILURE_TEXT[failReason]}` : ""}`;
  } else if (notSent.length === total) {
    line = notSentWhy ? `**DMs not sent** · ${notSentWhy}` : "**DMs not sent**";
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
    line = `**${deleted > 0 ? "No DMs left" : "No DMs sent"}** · ${parts.join(" · ")}`;
  }

  const content = override
    ? `${line}${suffix}\n-# ${override}`
    : `${line}${suffix}`;
  return { texts: [text(ACTION_RESPONSE_IDS.dm, content)], live: 0 };
}

function savePromptLine(emojis: ModerationActionEmojis): string {
  return `-# ${withEmoji(emojis.tip, "This reason has been used 3 or more times in this server. Save it as a template to reuse it from autocomplete and reason forms.")}`;
}

function buildTail(
  input: AssembleInput,
  encoded: string | null,
  live: number,
  showPrompt: boolean,
): APIComponentInContainer[] {
  const { cases, emojis, mode } = input;
  if (!encoded) {
    return [separator(), text(ACTION_RESPONSE_IDS.footer, TOO_MANY_CASES_LINE)];
  }
  if (mode === "expired") {
    return [separator(), text(ACTION_RESPONSE_IDS.footer, EXPIRED_LINE)];
  }

  const prompt = showPrompt
    ? [text(ACTION_RESPONSE_IDS.prompt, savePromptLine(emojis))]
    : [];

  if (mode === "confirmDeleteDm" && live > 0) {
    const liveCases = cases.filter(hasLiveDm);
    const confirm = buildDeleteDmConfirm({
      recipient: live === 1 ? { name: liveCases[0].userTag } : { count: live },
      confirmCustomId: buildResponseButtonId("dmDeleteConfirm", encoded),
      cancelCustomId: buildResponseButtonId("dmCancel", encoded),
    });
    return [
      separator(),
      ...prompt,
      confirm.prompt.setId(ACTION_RESPONSE_IDS.footer).toJSON(),
      confirm.row.toJSON(),
    ];
  }

  if (!showPrompt) {
    return [];
  }
  return [
    separator(),
    ...prompt,
    new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        button(
          "Save as template",
          buildResponseButtonId("save", encoded),
          ButtonStyle.Secondary,
          emojis.save,
        ),
      )
      .toJSON(),
  ];
}

/**
 * Header and details are given; everything else comes from the cases. The
 * reason is cut to whatever room the 4,000-character message limit leaves.
 */
function assemble(
  accentColor: number | undefined,
  header: APIComponentInContainer,
  details: APIComponentInContainer | null,
  body: AssembleInput,
): ContainerBuilder {
  const { cases, emojis, mode } = body;
  const encoded = encodeCaseIds(cases.map((c) => c.caseId));
  const buttonsLive = !!encoded && mode !== "expired";

  const notesText = notesContent(
    body.reasonNotes,
    attachmentsLine(cases, emojis),
  );
  const notes = notesText
    ? text(ACTION_RESPONSE_IDS.reasonNotes, notesText)
    : null;

  const dm = buildDmPart(body);
  const live = dm?.live ?? 0;
  const deleteDm =
    encoded && mode === "buttons" && live > 0
      ? button(
          live > 1 ? `Delete ${live} DMs` : "Delete DM",
          buildResponseButtonId("dmDelete", encoded),
          ButtonStyle.Secondary,
          emojis.trash,
        )
      : null;
  const dmComponents = dm
    ? [
        separator(),
        ...sectionOrTexts(ACTION_RESPONSE_IDS.dmSection, dm.texts, deleteDm),
      ]
    : [];

  // Kept while confirming Delete DM, so Cancel can restore Save as template.
  const showPrompt = body.savePrompt && buttonsLive && !!cases[0]?.reason;
  const tail = buildTail(body, encoded, live, showPrompt);

  const fixed = [header, details, notes, ...dmComponents, ...tail].filter(
    (c): c is APIComponentInContainer => c !== null,
  );
  // Expiry and the Delete DM confirm swap the tail without re-cutting the reason.
  const swaps = buttonsLive
    ? [
        textLength([text(ACTION_RESPONSE_IDS.footer, EXPIRED_LINE)]),
        live > 0
          ? textLength(
              buildTail(
                { ...body, mode: "confirmDeleteDm" },
                encoded,
                live,
                showPrompt,
              ),
            )
          : 0,
      ]
    : [];
  const reserve = Math.max(0, ...swaps.map((n) => n - textLength(tail)));
  const reason = text(
    ACTION_RESPONSE_IDS.reason,
    reasonContent(cases, MESSAGE_TEXT_MAX_LENGTH - textLength(fixed) - reserve),
  );

  const hasReason = !!cases[0]?.reason;
  const noun = isNote(cases) ? "note" : "reason";
  const edit =
    encoded && buttonsLive
      ? button(
          hasReason ? `Edit ${noun}` : `Add ${noun}`,
          buildResponseButtonId("edit", encoded),
          hasReason ? ButtonStyle.Secondary : ButtonStyle.Primary,
          emojis.message_edit,
        )
      : null;
  const reasonTexts = notes ? [reason, notes] : [reason];

  const components = [
    header,
    details,
    separator(),
    ...sectionOrTexts(ACTION_RESPONSE_IDS.reasonSection, reasonTexts, edit),
    ...dmComponents,
    ...tail,
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

  const header = buildHeader(
    input.actionType,
    input.executor,
    entries,
    input.emojis,
    now,
  );
  if (cases.length === 0) {
    return message(
      new ContainerBuilder({
        accent_color: accent,
        components: [header.toJSON()],
      }),
    );
  }

  const details = buildDetails(input, now);
  return message(
    assemble(accent, header.toJSON(), details?.toJSON() ?? null, {
      cases,
      emojis: input.emojis,
      reasonNotes: input.reasonNotes ?? [],
      dm: dmContentFor(cases, guildDmText(input.actionType, input.guildConfig)),
      savePrompt:
        (input.savePrompt ?? false) && input.actionType !== ActionType.Note,
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
 * Copies a header or details component without Discord's extra fields, such
 * as the ids it assigned to nested components or the media's proxy URL.
 */
function copyPreserved(
  component: APIComponentInContainer,
  id: number,
): APIComponentInContainer | null {
  if (component.type === ComponentType.TextDisplay) {
    return text(id, component.content);
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

const OWN_IDS = new Set<number>(Object.values(ACTION_RESPONSE_IDS));

function copyText(component: APITextDisplayComponent): APITextDisplayComponent {
  return OWN_IDS.has(component.id ?? 0)
    ? text(component.id ?? 0, component.content)
    : new TextDisplayBuilder().setContent(component.content).toJSON();
}

/** Copies a posted component of the shapes this view renders, dropping Discord-assigned ids. */
function copyKnown(
  component: APIComponentInContainer,
): APIComponentInContainer[] {
  if (component.type === ComponentType.Separator) {
    return [separator()];
  }
  if (component.type === ComponentType.TextDisplay) {
    return [copyText(component)];
  }
  if (
    component.type === ComponentType.Section &&
    component.accessory.type === ComponentType.Button
  ) {
    return component.components.map(copyText);
  }
  const copy = component.id ? copyPreserved(component, component.id) : null;
  return copy ? [copy] : [];
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
 * the extra DM text and attachments here, which now render elsewhere.
 */
function postedDetails(component: APIComponentInContainer | null): {
  details: APIComponentInContainer | null;
  legacyDmText: string | null;
} {
  const content = textOf(component);
  if (content === null) {
    return { details: null, legacyDmText: null };
  }
  const lines = content.split("\n");
  const duration = lines.filter((l) => DURATION_LINE.test(l));
  const quoted = lines.filter((l) => l.startsWith("> "));
  return {
    details: duration.length
      ? text(ACTION_RESPONSE_IDS.details, duration.join("\n"))
      : null,
    legacyDmText: quoted.length ? quoted.join("\n") : null,
  };
}

function textOf(component: APIComponentInContainer | null): string | null {
  return component?.type === ComponentType.TextDisplay
    ? component.content
    : null;
}

/** What the DM held when the response was posted; the cases only know the current reason. */
function postedDmContent(
  container: APIContainerComponent | null,
  cases: ModerationCase[],
  legacyDmText: string | null,
): DmContent {
  const line = findTextById(container, ACTION_RESPONSE_IDS.dm);
  if (line?.startsWith("**DM sent**")) {
    // The reason preview is always one line, so the rest is the extra DM text.
    const [heading, ...rest] = line.split("\n");
    const reasonLine = heading.endsWith(DM_RECEIVED)
      ? (rest.shift() ?? null)
      : null;
    return {
      reasonLine,
      configured: rest.length > 0 ? rest.join("\n") : null,
    };
  }
  return { reasonLine: dmReasonLine(cases), configured: legacyDmText };
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
 * Rebuilds a posted response from reloaded cases. The header, details and
 * what the DM held come from the posted message. Without new reasonNotes, the
 * old notes stay while the reason is unchanged; a reason changed elsewhere
 * gets an "Edited by" note from the case instead.
 */
export function rebuildActionResponse(
  posted: readonly APIMessageTopLevelComponent[],
  body: Omit<ResponseBodyInput, "reasonNotes"> & {
    reasonNotes?: readonly string[];
  },
): ActionResponseMessage {
  const container = findContainer(posted);
  const postedHeader = findById(container, ACTION_RESPONSE_IDS.header);
  const header =
    (postedHeader && copyPreserved(postedHeader, ACTION_RESPONSE_IDS.header)) ??
    fallbackHeader(body.cases, body.emojis);
  const { details, legacyDmText } = postedDetails(
    findById(container, ACTION_RESPONSE_IDS.details),
  );

  let reasonNotes = body.reasonNotes;
  if (!reasonNotes) {
    const postedReason = findTextById(container, ACTION_RESPONSE_IDS.reason);
    const postedNotes = findTextById(
      container,
      ACTION_RESPONSE_IDS.reasonNotes,
    );
    const fresh = reasonBody(
      reasonContent(body.cases, Number.MAX_SAFE_INTEGER),
    );
    const old = postedReason === null ? null : reasonBody(postedReason);
    // A reason cut to fit can only be compared by its uncut start.
    const unchanged =
      old !== null &&
      (old === fresh ||
        (old.endsWith(ELLIPSIS) &&
          fresh.startsWith(old.slice(0, -ELLIPSIS.length).trimEnd())));
    if (unchanged) {
      reasonNotes = postedNotes
        ? parseNotes(postedNotes, attachmentsLine(body.cases, body.emojis))
        : [];
    } else {
      const first = body.cases[0];
      reasonNotes =
        first?.reasonSetBy && first.reasonSetAt
          ? [editedNote(first.reasonSetBy, first.reasonSetAt)]
          : [];
    }
  }

  const dm = postedDmContent(container, body.cases, legacyDmText);
  if (body.dmReasonUpdated) {
    dm.reasonLine = dmReasonLine(body.cases);
  }

  return message(
    assemble(container?.accent_color ?? undefined, header, details, {
      ...body,
      reasonNotes,
      dm,
    }),
  );
}

/**
 * The posted response with its buttons, save prompt and Delete DM confirm
 * replaced by the expired line. null when it already shows it.
 */
export function expireActionResponse(
  posted: readonly APIMessageTopLevelComponent[],
): ActionResponseMessage | null {
  const container = findContainer(posted);
  if (!container) {
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

  const kept = container.components.flatMap((c) => {
    if (
      c.type === ComponentType.ActionRow ||
      c.id === ACTION_RESPONSE_IDS.prompt ||
      c.id === ACTION_RESPONSE_IDS.footer
    ) {
      return [];
    }
    return copyKnown(c);
  });
  if (kept.at(-1)?.type !== ComponentType.Separator) {
    kept.push(separator());
  }

  return message(
    new ContainerBuilder({
      accent_color: container.accent_color ?? undefined,
      components: [...kept, text(ACTION_RESPONSE_IDS.footer, EXPIRED_LINE)],
    }),
  );
}

/** True once the expiry timer or an expired click has stripped the buttons. */
export function showsExpiredLine(
  posted: readonly APIMessageTopLevelComponent[],
): boolean {
  return (
    textOf(findById(findContainer(posted), ACTION_RESPONSE_IDS.footer)) ===
    EXPIRED_LINE
  );
}
