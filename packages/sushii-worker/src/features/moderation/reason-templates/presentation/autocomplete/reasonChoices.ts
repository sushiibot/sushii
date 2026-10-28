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
  previewText,
  recentChoiceValue,
  templateChoiceValue,
} from "../../domain/ReasonExpander";

export type ReasonChoice = ApplicationCommandOptionChoiceData<string>;

export const MAX_CHOICES = 25;
/** Recent reasons keep a few slots on an empty field so they aren't crowded out by templates. */
const EMPTY_FIELD_RECENT_SLOTS = 5;
const SHORTCUT_WITH_EXTRA = /^!\S+\s+([\s\S]*)$/;
export const TIP_NAME =
  "Tip: make templates in /reason-templates, then type !shortcut";
const TOKEN_INPUT = /^(?:template|recent):/;
const AS_TYPED_FRAME = 'Use "" as typed'.length;

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

function asTypedChoice(typed: string): ReasonChoice {
  return {
    name: `Use "${previewText(typed, LABEL_MAX_LENGTH - AS_TYPED_FRAME)}" as typed`,
    value: typed,
  };
}

function tipChoice(typed: string): ReasonChoice {
  return { name: TIP_NAME, value: typed };
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
  const recentSlots = Math.min(recents.length, EMPTY_FIELD_RECENT_SLOTS);

  return [
    ...templates.slice(0, MAX_CHOICES - recentSlots).map(templateChoice),
    ...recents.map(recentChoice),
  ];
}

function unknownShortcutChoices(
  typed: string,
  shortcut: string,
  templates: readonly TemplateLike[],
): ReasonChoice[] {
  const extra = SHORTCUT_WITH_EXTRA.exec(typed)?.[1]?.trim() ?? "";
  const warning: ReasonChoice = {
    name: `No template !${shortcut}, it will be used as typed`,
    value: typed,
  };

  // Mid-typing "!sp" toward "!spam": offer the shortcuts it could become.
  if (!extra) {
    const startsWith = templates.filter((t) =>
      t.shortcut?.startsWith(shortcut),
    );
    if (startsWith.length > 0) {
      return [
        ...startsWith.slice(0, MAX_CHOICES - 1).map(templateChoice),
        warning,
      ];
    }
  }

  const choices = [warning];
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

function filterChoices(
  typed: string,
  templates: readonly TemplateLike[],
  recents: RecentReasonEntry[],
): ReasonChoice[] {
  const needle = normalizeReason(typed.replace(/^!/, ""));
  const matchingTemplates = templates.filter(
    (t) =>
      (t.shortcut?.includes(needle) ?? false) ||
      normalizeReason(t.content).includes(needle),
  );
  const matchingRecents = recents.filter((r) =>
    normalizeReason(r.reason).includes(needle),
  );

  return [
    ...matchingTemplates.map(templateChoice),
    ...matchingRecents.map(recentChoice),
  ];
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

  const nothingSaved = templates.length === 0;

  if (expanded.unknownShortcut) {
    return finalize([
      ...unknownShortcutChoices(typed, expanded.unknownShortcut, templates),
      ...(nothingSaved ? [tipChoice(typed)] : []),
    ]);
  }

  // A typed token already resolves; echoing it as typed would mislabel it.
  const trailing = TOKEN_INPUT.test(typed)
    ? []
    : [
        asTypedChoice(typed),
        ...(nothingSaved ? [tipChoice(typed)] : []),
      ].filter(isValidChoice);

  return finalize([
    ...filterChoices(typed, templates, recents).slice(
      0,
      MAX_CHOICES - trailing.length,
    ),
    ...trailing,
  ]);
}
