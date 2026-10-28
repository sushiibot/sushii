export type ReasonSurface = "command" | "form" | "reason_cmd" | "edit";

export type ReasonSource =
  | "typed"
  | "template"
  | "shortcut"
  | "recent"
  | "unknown_shortcut"
  | "refused"
  | "too_long";

export type TemplateChangeAction = "create" | "update" | "delete";
export type TemplateChangeOrigin = "panel" | "save_prompt" | "checkbox";
export type TemplateChangeOutcome =
  | "ok"
  | "conflict"
  | "limit"
  | "invalid"
  | "not_found";

export type SavePromptEvent = "shown" | "clicked";

export type ActionResponseButtonKind =
  | "edit_reason"
  | "delete_dm"
  | "save_template"
  | "retry";
export type ActionResponseButtonOutcome =
  | "ok"
  | "expired"
  | "denied"
  | "dismissed"
  | "failed";

export type ModLogEditKind =
  | "legacy_conversion"
  | "v2"
  | "dm_edit"
  | "dm_delete";

export const MOD_LOG_EDIT_KINDS: readonly ModLogEditKind[] = [
  "legacy_conversion",
  "v2",
  "dm_edit",
  "dm_delete",
];

export type ModLogEditOutcome = "ok" | "failed";

/** Recording is synchronous and must never throw into the feature. */
export interface ModerationMetrics {
  recordReasonResolved(surface: ReasonSurface, source: ReasonSource): void;
  recordTemplateChange(
    action: TemplateChangeAction,
    origin: TemplateChangeOrigin,
    outcome: TemplateChangeOutcome,
  ): void;
  recordSavePrompt(event: SavePromptEvent): void;
  recordActionResponseButton(
    button: ActionResponseButtonKind,
    outcome: ActionResponseButtonOutcome,
  ): void;
  recordModLogEdit(kind: ModLogEditKind, outcome: ModLogEditOutcome): void;
}

export const NOOP_MODERATION_METRICS: ModerationMetrics = {
  recordReasonResolved: () => undefined,
  recordTemplateChange: () => undefined,
  recordSavePrompt: () => undefined,
  recordActionResponseButton: () => undefined,
  recordModLogEdit: () => undefined,
};

export interface ReasonTracking {
  metrics: Pick<ModerationMetrics, "recordReasonResolved">;
  surface: ReasonSurface;
}

/** Structural slice of ExpandResult, so this module stays free of feature imports. */
export interface ExpandedReason {
  source: "token" | "label" | "shortcut" | "none";
  template: { shortcut: string | null } | null;
  unknownShortcut: string | null;
  unresolved: unknown;
}

/**
 * null when there's no reason to count. A typed expansion wins over a
 * dropdown pick, since the pick is only a prefix to it.
 */
export function reasonSource(input: {
  surface: ReasonSurface;
  expanded: ExpandedReason | null;
  picked?: "template" | "recent" | null;
  tooLong: boolean;
  hasText: boolean;
}): ReasonSource | null {
  const { surface, expanded, picked, tooLong, hasText } = input;

  if (expanded?.unresolved) {
    return "refused";
  }
  if (tooLong) {
    return "too_long";
  }
  if (expanded?.unknownShortcut) {
    return "unknown_shortcut";
  }

  switch (expanded?.source) {
    case "token":
      // Forms have no autocomplete, so an exact `!spam` there was typed.
      if (
        expanded.template?.shortcut &&
        (surface === "form" || surface === "edit")
      ) {
        return "shortcut";
      }
      return expanded.template ? "template" : "recent";
    case "label":
      return expanded.template ? "template" : "recent";
    case "shortcut":
      return "shortcut";
    default:
      break;
  }

  if (picked) {
    return picked;
  }

  return hasText ? "typed" : null;
}

export function templateChangeOutcome(
  code:
    | "shortcut_taken"
    | "duplicate"
    | "limit_reached"
    | "invalid_shortcut"
    | "empty"
    | "too_long"
    | "not_found",
): TemplateChangeOutcome {
  switch (code) {
    case "shortcut_taken":
    case "duplicate":
      return "conflict";
    case "limit_reached":
      return "limit";
    case "not_found":
      return "not_found";
    case "invalid_shortcut":
    case "empty":
    case "too_long":
      return "invalid";
  }
}
