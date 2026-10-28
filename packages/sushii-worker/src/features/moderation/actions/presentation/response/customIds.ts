const PREFIX = "modAction/";

export type ResponseButtonKind =
  | "edit"
  | "dmDelete"
  | "dmDeleteConfirm"
  | "dmCancel"
  | "save";

const KIND_PATHS: Record<ResponseButtonKind, string> = {
  edit: `${PREFIX}reason/edit/`,
  dmDelete: `${PREFIX}dm/delete/`,
  dmDeleteConfirm: `${PREFIX}dm/deleteConfirm/`,
  dmCancel: `${PREFIX}dm/cancel/`,
  save: `${PREFIX}save/`,
};

const CUSTOM_ID_MAX_LENGTH = 100;
const LONGEST_PATH = Math.max(
  ...Object.values(KIND_PATHS).map((path) => path.length),
);
/** Every button of one response shares the encoded cases, so they must fit the longest path. */
export const ENCODED_CASES_MAX_LENGTH = CUSTOM_ID_MAX_LENGTH - LONGEST_PATH;
/** An action targets at most 25 users. */
const MAX_DECODED_CASES = 25;
const CASE_ID_PATTERN = /^[1-9]\d{0,14}$/;
const SEGMENT_PATTERN = /^([1-9]\d{0,14})(?:-([1-9]\d{0,14}))?$/;

export interface ResponseButton {
  kind: ResponseButtonKind;
  caseIds: string[];
}

function sortedUnique(caseIds: readonly string[]): number[] {
  const numbers = caseIds
    .filter((id) => CASE_ID_PATTERN.test(id))
    .map(Number)
    .filter(Number.isSafeInteger);
  return [...new Set(numbers)].sort((a, b) => a - b);
}

/** Runs of consecutive case IDs as "a-b" or "a", in ascending order. */
export function toCaseRuns(caseIds: readonly string[]): string[] {
  const runs: string[] = [];
  const sorted = sortedUnique(caseIds);

  let start: number | null = null;
  let previous = 0;
  for (const id of sorted) {
    if (start !== null && id === previous + 1) {
      previous = id;
      continue;
    }
    if (start !== null) {
      runs.push(start === previous ? `${start}` : `${start}-${previous}`);
    }
    start = id;
    previous = id;
  }
  if (start !== null) {
    runs.push(start === previous ? `${start}` : `${start}-${previous}`);
  }

  return runs;
}

/** "4822-4823,4830", or null when it can't fit every button's custom ID. */
export function encodeCaseIds(caseIds: readonly string[]): string | null {
  const encoded = toCaseRuns(caseIds).join(",");
  if (!encoded || encoded.length > ENCODED_CASES_MAX_LENGTH) {
    return null;
  }

  return encoded;
}

export function decodeCaseIds(encoded: string): string[] | null {
  const ids: string[] = [];

  for (const segment of encoded.split(",")) {
    const match = SEGMENT_PATTERN.exec(segment);
    if (!match) {
      return null;
    }

    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    if (end < start || end - start + 1 + ids.length > MAX_DECODED_CASES) {
      return null;
    }

    for (let id = start; id <= end; id++) {
      ids.push(`${id}`);
    }
  }

  return ids;
}

export function buildResponseButtonId(
  kind: ResponseButtonKind,
  encodedCases: string,
): string {
  return `${KIND_PATHS[kind]}${encodedCases}`;
}

export function parseResponseButtonId(customId: string): ResponseButton | null {
  for (const [kind, path] of Object.entries(KIND_PATHS) as [
    ResponseButtonKind,
    string,
  ][]) {
    if (!customId.startsWith(path)) {
      continue;
    }

    const caseIds = decodeCaseIds(customId.slice(path.length));
    return caseIds ? { kind, caseIds } : null;
  }

  return null;
}

/** Fits MessageComponentHandler.customIDMatch. */
export function matchResponseButtonId(
  customId: string,
): { path: string; index: number; params: object } | false {
  return parseResponseButtonId(customId)
    ? { path: customId, index: 0, params: {} }
    : false;
}

/** Unique per click so a collector from a dismissed form can't take a later submit. */
export function buildResponseModalId(interactionId: string): string {
  return `${PREFIX}reasonForm/${interactionId}`;
}
