import type { ApplicationCommandOptionChoiceData } from "discord.js";

import { normalizeReason } from "@/features/moderation/shared/domain/value-objects/normalizeReason";
import { truncateText } from "@/utils/truncateText";

import type {
  RecentReasonEntry,
  TemplateLike,
} from "../../domain/ReasonExpander";
import {
  LABEL_MAX_LENGTH,
  buildExpansionLabel,
  buildRecentLabel,
  buildTemplateLabel,
  closestShortcut,
  expandReason,
  recentChoiceValue,
  templateChoiceValue,
} from "../../domain/ReasonExpander";

export type ReasonChoice = ApplicationCommandOptionChoiceData<string>;

export const MAX_CHOICES = 25;
/** Only the newest few recent reasons are offered; older ones are noise next to templates. */
export const SHOWN_RECENT_LIMIT = 3;
const SHORTCUT_WITH_EXTRA = /^!\S+\s+([\s\S]*)$/;

export interface ReasonChoiceSources {
  /** Most used first. */
  templates: readonly TemplateLike[];
  /** Newest first. */
  recents: readonly RecentReasonEntry[];
}

function templateChoice(template: TemplateLike): ReasonChoice {
  return {
    name: buildTemplateLabel(template),
    value: templateChoiceValue(template),
  };
}

function recentChoice(recent: RecentReasonEntry): ReasonChoice {
  return { name: buildRecentLabel(recent), value: recentChoiceValue(recent) };
}

function isValidChoice(choice: ReasonChoice): boolean {
  return (
    choice.name.trim().length > 0 &&
    choice.value.trim().length > 0 &&
    choice.name.length <= LABEL_MAX_LENGTH &&
    choice.value.length <= LABEL_MAX_LENGTH
  );
}

function finalize(choices: ReasonChoice[]): ReasonChoice[] {
  return choices.filter(isValidChoice).slice(0, MAX_CHOICES);
}

/** Drops blank recents and recents that repeat a template's text. */
function usableRecents(sources: ReasonChoiceSources): RecentReasonEntry[] {
  const templateKeys = new Set(
    sources.templates.map((t) => normalizeReason(t.content)),
  );

  return sources.recents.filter((r) => {
    const key = normalizeReason(r.reason);
    return key.length > 0 && !templateKeys.has(key);
  });
}

function emptyFieldChoices(
  templates: readonly TemplateLike[],
  recents: RecentReasonEntry[],
): ReasonChoice[] {
  const shown = recents.slice(0, SHOWN_RECENT_LIMIT);

  return [
    ...templates.slice(0, MAX_CHOICES - shown.length).map(templateChoice),
    ...shown.map(recentChoice),
  ];
}

function unknownShortcutChoices(
  typed: string,
  shortcut: string,
  templates: readonly TemplateLike[],
): ReasonChoice[] {
  const extra = SHORTCUT_WITH_EXTRA.exec(typed)?.[1]?.trim() ?? "";

  // Mid-typing "!sp" toward "!spam": offer the shortcuts it could become.
  if (!extra) {
    const startsWith = templates.filter((t) =>
      t.shortcut?.startsWith(shortcut),
    );
    if (startsWith.length > 0) {
      return startsWith.slice(0, MAX_CHOICES).map(templateChoice);
    }
  }

  const choices: ReasonChoice[] = [];
  const shortcuts = templates.flatMap((t) => (t.shortcut ? [t.shortcut] : []));
  const closest = closestShortcut(shortcut, shortcuts);
  const suggestion =
    closest === null
      ? undefined
      : templates.find((t) => t.shortcut === closest);
  const value = suggestion
    ? [templateChoiceValue(suggestion), extra].filter(Boolean).join(" ")
    : "";
  // Too long to carry the extra text: no suggestion rather than one that drops it.
  if (suggestion && value.length <= LABEL_MAX_LENGTH) {
    choices.push({
      name: truncateText(
        `Did you mean ${buildTemplateLabel(suggestion)}`,
        LABEL_MAX_LENGTH,
      ),
      value,
    });
  }

  return choices;
}

/** Typed text only searches templates; recent reasons are offered on an empty field. */
function filterChoices(
  typed: string,
  templates: readonly TemplateLike[],
): ReasonChoice[] {
  const needle = normalizeReason(typed.replace(/^!/, ""));

  return templates
    .filter(
      (t) =>
        (t.shortcut?.includes(needle) ?? false) ||
        normalizeReason(t.content).includes(needle),
    )
    .map(templateChoice);
}

/**
 * Choices for a slash-command reason option. Every value is either a token
 * expandReason resolves or the typed text itself, so picking one never
 * changes the meaning of what was typed.
 */
export function buildReasonChoices(
  input: string,
  sources: ReasonChoiceSources,
): ReasonChoice[] {
  const typed = input.trim();
  const { templates } = sources;
  const recents = usableRecents(sources);

  if (!typed) {
    return finalize(emptyFieldChoices(templates, recents));
  }

  const expanded = expandReason(typed, { templates, recents });

  // A picked label (possibly with more typed after it) already resolves on submit.
  if (expanded.unresolved || expanded.source === "label") {
    return [];
  }

  if (expanded.template && expanded.source === "shortcut") {
    const extra = SHORTCUT_WITH_EXTRA.exec(typed)?.[1] ?? "";
    const template = templates.find((t) => t.id === expanded.template?.id);

    return template
      ? finalize([{ name: buildExpansionLabel(template, extra), value: typed }])
      : [];
  }

  if (expanded.template && expanded.source === "token") {
    const exact = templates.find((t) => t.id === expanded.template?.id);
    const shortcut = exact?.shortcut;
    const others = shortcut
      ? templates.filter((t) => t !== exact && t.shortcut?.startsWith(shortcut))
      : [];

    return finalize(
      [exact, ...others].flatMap((t) => (t ? [templateChoice(t)] : [])),
    );
  }

  if (expanded.unknownShortcut) {
    return finalize(
      unknownShortcutChoices(typed, expanded.unknownShortcut, templates),
    );
  }

  return finalize(filterChoices(typed, templates));
}
