export const SUGGEST_PREFIX = "proof/suggest/";

const CUSTOM_ID_MAX_LENGTH = 100;
const CASE_ID = /^\d{1,20}$/;
const FINGERPRINT = /^[0-9a-f]{8}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stands in for a fingerprint on the mod log button, which is the same for every viewer. */
export const MOD_LOG_REVIEW_MARKER = "log";

export type SuggestButton =
  | { kind: "review"; caseId: string; fingerprint: string | null }
  | { kind: "add"; caseId: string; fingerprint: string }
  | { kind: "add-selected"; caseId: string; fingerprint: string }
  | { kind: "undo"; caseId: string; batchId: string };

export interface SuggestSelect {
  caseId: string;
  fingerprint: string;
}

function checked(customId: string): string {
  if (customId.length > CUSTOM_ID_MAX_LENGTH) {
    throw new Error("Suggested proof custom ID exceeds 100 characters", {
      cause: { length: customId.length },
    });
  }
  return customId;
}

/** `fingerprint` null for the mod log button. */
export function buildReviewId(
  caseId: string,
  fingerprint: string | null,
): string {
  return checked(
    `${SUGGEST_PREFIX}review/${caseId}/${fingerprint ?? MOD_LOG_REVIEW_MARKER}`,
  );
}

export function buildAddAllId(caseId: string, fingerprint: string): string {
  return checked(`${SUGGEST_PREFIX}add/${caseId}/${fingerprint}`);
}

export function buildSelectId(caseId: string, fingerprint: string): string {
  return checked(`${SUGGEST_PREFIX}select/${caseId}/${fingerprint}`);
}

export function buildAddSelectedId(
  caseId: string,
  fingerprint: string,
): string {
  return checked(`${SUGGEST_PREFIX}add-selected/${caseId}/${fingerprint}`);
}

export function buildUndoId(caseId: string, batchId: string): string {
  return checked(`${SUGGEST_PREFIX}undo/${caseId}/${batchId}`);
}

export function isSuggestButtonId(customId: string): boolean {
  return (
    customId.startsWith(SUGGEST_PREFIX) &&
    !customId.startsWith(`${SUGGEST_PREFIX}select/`)
  );
}

export function isSuggestSelectId(customId: string): boolean {
  return customId.startsWith(`${SUGGEST_PREFIX}select/`);
}

export function isSuggestUndoId(customId: string): boolean {
  return customId.startsWith(`${SUGGEST_PREFIX}undo/`);
}

/** null for anything garbled, so the handler can say the button is out of date. */
export function parseSuggestButtonId(customId: string): SuggestButton | null {
  if (!customId.startsWith(SUGGEST_PREFIX)) {
    return null;
  }

  const parts = customId.slice(SUGGEST_PREFIX.length).split("/");
  if (parts.length !== 3) {
    return null;
  }
  const [kind, caseId, last] = parts;
  if (!CASE_ID.test(caseId)) {
    return null;
  }

  switch (kind) {
    case "review":
      if (last === MOD_LOG_REVIEW_MARKER) {
        return { kind, caseId, fingerprint: null };
      }
      return FINGERPRINT.test(last)
        ? { kind, caseId, fingerprint: last }
        : null;
    case "add":
    case "add-selected":
      return FINGERPRINT.test(last)
        ? { kind, caseId, fingerprint: last }
        : null;
    case "undo":
      return UUID.test(last) ? { kind, caseId, batchId: last } : null;
    default:
      return null;
  }
}

export function parseSuggestSelectId(customId: string): SuggestSelect | null {
  const match = /^proof\/suggest\/select\/(\d{1,20})\/([0-9a-f]{8})$/.exec(
    customId,
  );
  if (!match) {
    return null;
  }
  return { caseId: match[1], fingerprint: match[2] };
}

const CUSTOM_ID_IN_JSON = /"custom_id":"([^"]+)"/g;

/** The fingerprint of the Add all button on a posted response, if it has one. */
export function postedAddAllFingerprint(componentsJson: string): string | null {
  for (const match of componentsJson.matchAll(CUSTOM_ID_IN_JSON)) {
    const parsed = parseSuggestButtonId(match[1]);
    if (parsed?.kind === "add") {
      return parsed.fingerprint;
    }
  }
  return null;
}
