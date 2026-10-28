import { createHash } from "node:crypto";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import { normalizeReason } from "@/features/moderation/shared/domain/value-objects/normalizeReason";
import { ELLIPSIS, truncateText } from "@/utils/truncateText";

import type { ReasonTemplate } from "./ReasonTemplate";

export { normalizeReason };

/** Discord limit for autocomplete choice names and select option labels. */
export const LABEL_MAX_LENGTH = 100;
export const SHORTCUT_MAX_LENGTH = 32;

const SHORTCUT_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const SHORTCUT_INPUT_PATTERN = /^!(\S+)(?:\s+([\s\S]*))?$/;
const TEMPLATE_TOKEN_PREFIX = "template:";
const RECENT_TOKEN_PREFIX = "recent:";
const TEMPLATE_TOKEN_PATTERN = /^template:(\S*)$/;
export const RECENT_TOKEN_PATTERN = /^recent:(\S*)$/;
// Every autocomplete choice name we build, so an edited pick is refused instead of saved as text.
const LABEL_SHAPE_PATTERN =
  /^(?:(?:!\S+|Template|Recent) · |!\S+ → |Use ".*" as typed|No template !\S+,|Did you mean !|Tip: make templates in \/)/;
const LABEL_SEPARATOR = " · ";
const EXPANSION_ARROW = " → ";
const EXPANSION_PLUS = " + ";
const MIN_EXPANSION_TEMPLATE_PREVIEW = 12;

export type TemplateLike = Pick<ReasonTemplate, "id" | "shortcut" | "content">;

export interface RecentReasonEntry {
  caseId: string;
  reason: string;
}

export interface TemplateRef {
  id: string;
  shortcut: string | null;
}

export type ExpandSource = "token" | "label" | "shortcut" | "none";

export type UnresolvedKind = "token" | "stale_label" | "ambiguous_label";

export interface ExpandResult {
  text: string;
  template: TemplateRef | null;
  unknownShortcut: string | null;
  source: ExpandSource;
  /** Set when the input referred to something that can't be resolved now; text is then the raw input. */
  unresolved: { kind: UnresolvedKind; input: string } | null;
}

export interface ExpandSources {
  templates: readonly TemplateLike[];
  recents: readonly RecentReasonEntry[];
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Fixed-length key, since a full reason can exceed the btree index row limit. */
export function reasonContentKey(text: string): string {
  return createHash("sha256").update(normalizeReason(text)).digest("hex");
}

export function normalizeShortcut(input: string): Result<string, "invalid"> {
  const trimmed = input.trim();
  const withoutBang = trimmed.startsWith("!") ? trimmed.slice(1) : trimmed;
  const shortcut = withoutBang.toLowerCase();

  if (!SHORTCUT_PATTERN.test(shortcut)) {
    return Err("invalid");
  }

  return Ok(shortcut);
}

export function previewText(text: string, maxLength: number): string {
  return truncateText(collapseWhitespace(text), maxLength);
}

function templatePrefix(template: TemplateLike): string {
  return template.shortcut ? `!${template.shortcut}` : "Template";
}

export function toTemplateRef(template: TemplateLike): TemplateRef {
  return { id: template.id, shortcut: template.shortcut };
}

export function buildTemplateLabel(template: TemplateLike): string {
  const prefix = templatePrefix(template) + LABEL_SEPARATOR;

  return (
    prefix + previewText(template.content, LABEL_MAX_LENGTH - prefix.length)
  );
}

export function buildRecentLabel(recent: RecentReasonEntry): string {
  const prefix = "Recent" + LABEL_SEPARATOR;

  return prefix + previewText(recent.reason, LABEL_MAX_LENGTH - prefix.length);
}

export function buildExpansionLabel(
  template: TemplateLike,
  extra: string,
): string {
  const head = templatePrefix(template) + EXPANSION_ARROW;
  const content = collapseWhitespace(template.content);
  const extraText = collapseWhitespace(extra);

  if (!extraText) {
    return head + previewText(content, LABEL_MAX_LENGTH - head.length);
  }

  const budget = LABEL_MAX_LENGTH - head.length - EXPANSION_PLUS.length;
  const templateBudget = Math.min(
    content.length,
    Math.max(MIN_EXPANSION_TEMPLATE_PREVIEW, budget - extraText.length),
  );
  const templatePreview = previewText(content, templateBudget);
  const extraPreview = previewText(extraText, budget - templatePreview.length);

  return head + templatePreview + EXPANSION_PLUS + extraPreview;
}

export function templateChoiceValue(template: TemplateLike): string {
  return template.shortcut
    ? `!${template.shortcut}`
    : `${TEMPLATE_TOKEN_PREFIX}${template.id}`;
}

export function recentChoiceValue(recent: RecentReasonEntry): string {
  return `${RECENT_TOKEN_PREFIX}${recent.caseId}`;
}

export function joinReason(base: string, extra: string): string {
  const head = base.trimEnd();
  let tail = extra.trim();

  if (!tail) {
    return head;
  }

  if (!head) {
    return tail;
  }

  if (/[.!?]$/.test(head)) {
    tail = tail.charAt(0).toUpperCase() + tail.slice(1);
  }

  return `${head} ${tail}`;
}

// Optimal string alignment: an adjacent swap ("spma" → "spam") costs 1.
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) =>
      i === 0 ? j : j === 0 ? i : 0,
    ),
  );

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, d[i - 2][j - 2] + 1);
      }
      d[i][j] = best;
    }
  }

  return d[a.length][b.length];
}

/** Ties go to the alphabetically first shortcut. */
export function closestShortcut(
  input: string,
  shortcuts: readonly string[],
): string | null {
  const needle = input.trim().replace(/^!/, "").toLowerCase();
  if (needle.length < 2) {
    return null;
  }

  // Short inputs only tolerate small typos, or everything looks "close".
  const maxDistance = Math.min(2, Math.floor(needle.length / 3));

  let best: { shortcut: string; distance: number } | null = null;
  for (const shortcut of shortcuts) {
    const distance = editDistance(needle, shortcut);
    if (distance > maxDistance) {
      continue;
    }

    if (
      !best ||
      distance < best.distance ||
      (distance === best.distance && shortcut < best.shortcut)
    ) {
      best = { shortcut, distance };
    }
  }

  return best?.shortcut ?? null;
}

function resolved(
  text: string,
  template: TemplateRef | null,
  source: ExpandSource,
): ExpandResult {
  return { text, template, unknownShortcut: null, source, unresolved: null };
}

function unresolved(input: string, kind: UnresolvedKind): ExpandResult {
  return {
    text: input,
    template: null,
    unknownShortcut: null,
    source: "none",
    unresolved: { kind, input },
  };
}

function matchToken(
  input: string,
  { templates, recents }: ExpandSources,
): ExpandResult | null {
  const templateToken = TEMPLATE_TOKEN_PATTERN.exec(input);
  if (templateToken) {
    const template = templates.find((t) => t.id === templateToken[1]);

    return template
      ? resolved(template.content, toTemplateRef(template), "token")
      : unresolved(input, "token");
  }

  const recentToken = RECENT_TOKEN_PATTERN.exec(input);
  if (recentToken) {
    const recent = recents.find((r) => r.caseId === recentToken[1]);

    return recent
      ? resolved(recent.reason, null, "token")
      : unresolved(input, "token");
  }

  if (input.startsWith("!") && !/\s/.test(input)) {
    const shortcut = normalizeShortcut(input);
    if (shortcut.err) {
      return null;
    }

    const template = templates.find((t) => t.shortcut === shortcut.val);

    return template
      ? resolved(template.content, toTemplateRef(template), "token")
      : null;
  }

  return null;
}

// The label must end at a word boundary unless Discord cut it with an ellipsis.
function labelMatches(input: string, label: string): boolean {
  if (!input.startsWith(label)) {
    return false;
  }

  const rest = input.slice(label.length);

  return rest === "" || /^\s/.test(rest) || label.endsWith(ELLIPSIS);
}

function matchLabel(
  input: string,
  { templates, recents }: ExpandSources,
): ExpandResult | null {
  const candidates = [
    ...templates.map((t) => ({
      label: buildTemplateLabel(t),
      text: t.content,
      template: toTemplateRef(t) as TemplateRef | null,
    })),
    ...recents.map((r) => ({
      label: buildRecentLabel(r),
      text: r.reason,
      template: null,
    })),
  ].filter((candidate) => labelMatches(input, candidate.label));

  if (candidates.length === 0) {
    return LABEL_SHAPE_PATTERN.test(input)
      ? unresolved(input, "stale_label")
      : null;
  }

  const longest = Math.max(...candidates.map((c) => c.label.length));
  const best = candidates.filter((c) => c.label.length === longest);
  if (new Set(best.map((c) => c.text)).size > 1) {
    return unresolved(input, "ambiguous_label");
  }

  const [match] = best;
  if (!match) {
    return null;
  }

  return resolved(
    joinReason(match.text, input.slice(match.label.length)),
    match.template,
    "label",
  );
}

/** Precedence: exact token, bot-built label prefix, `!shortcut rest`, raw input. */
export function expandReason(
  input: string,
  sources: ExpandSources,
): ExpandResult {
  const trimmed = input.trim();

  const token = matchToken(trimmed, sources);
  if (token) {
    return token;
  }

  const label = matchLabel(trimmed, sources);
  if (label) {
    return label;
  }

  let unknownShortcut: string | null = null;
  const shortcutMatch = SHORTCUT_INPUT_PATTERN.exec(trimmed);
  if (shortcutMatch?.[1]) {
    const shortcut = normalizeShortcut(shortcutMatch[1]);
    if (shortcut.ok) {
      const template = sources.templates.find(
        (t) => t.shortcut === shortcut.val,
      );

      if (template) {
        return resolved(
          joinReason(template.content, shortcutMatch[2] ?? ""),
          toTemplateRef(template),
          "shortcut",
        );
      }

      unknownShortcut = shortcut.val;
    }
  }

  return {
    text: trimmed,
    template: null,
    unknownShortcut,
    source: "none",
    unresolved: null,
  };
}
