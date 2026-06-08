const IGNORE_PREFIX = "scam_candidate:ignore:";
const ADD_PREFIX = "scam_candidate:add:";
const MODAL_PREFIX = "scam_candidate:label:";
const REVERT_PREFIX = "scam_candidate:revert:";

export const SCAM_CANDIDATE_MODAL_LABEL_INPUT = "label";

export function buildIgnoreId(reviewId: string): string {
  return `${IGNORE_PREFIX}${reviewId}`;
}

export function buildAddId(reviewId: string): string {
  return `${ADD_PREFIX}${reviewId}`;
}

export function buildModalId(reviewId: string): string {
  return `${MODAL_PREFIX}${reviewId}`;
}

export function parseIgnoreId(customId: string): string | null {
  return customId.startsWith(IGNORE_PREFIX) ? customId.slice(IGNORE_PREFIX.length) : null;
}

export function parseAddId(customId: string): string | null {
  return customId.startsWith(ADD_PREFIX) ? customId.slice(ADD_PREFIX.length) : null;
}

export function parseModalId(customId: string): string | null {
  return customId.startsWith(MODAL_PREFIX) ? customId.slice(MODAL_PREFIX.length) : null;
}

export function buildRevertId(reviewId: string): string {
  return `${REVERT_PREFIX}${reviewId}`;
}

export function parseRevertId(customId: string): string | null {
  return customId.startsWith(REVERT_PREFIX) ? customId.slice(REVERT_PREFIX.length) : null;
}
