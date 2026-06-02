const IGNORE_PREFIX = "scam_candidate:ignore:";
const ADD_PREFIX = "scam_candidate:add:";
const MODAL_PREFIX = "scam_candidate:label:";

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
