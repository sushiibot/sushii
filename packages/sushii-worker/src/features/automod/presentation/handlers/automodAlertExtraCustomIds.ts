const REPORT_HASH_PREFIX = "automod_alert:report_hash:";
const REPORT_REVERT_PREFIX = "automod_alert:report_revert:";
const REPORT_DISMISS_PREFIX = "automod_alert:report_dismiss:";
const REMOVE_TIMEOUT_PREFIX = "automod_alert:remove_timeout:";

function parseIntId(customId: string, prefix: string): number | null {
  if (!customId.startsWith(prefix)) {
    return null;
  }
  const id = Number(customId.slice(prefix.length));
  return Number.isFinite(id) ? id : null;
}

export function buildReportHashId(hashId: number): string {
  return `${REPORT_HASH_PREFIX}${hashId}`;
}

export function parseReportHashId(customId: string): number | null {
  return parseIntId(customId, REPORT_HASH_PREFIX);
}

// Revert/dismiss buttons live on the review message and key off the report
// row id, not the hash id — a hash can be reported more than once.
export function buildReportRevertId(reportId: number): string {
  return `${REPORT_REVERT_PREFIX}${reportId}`;
}

export function parseReportRevertId(customId: string): number | null {
  return parseIntId(customId, REPORT_REVERT_PREFIX);
}

export function buildReportDismissId(reportId: number): string {
  return `${REPORT_DISMISS_PREFIX}${reportId}`;
}

export function parseReportDismissId(customId: string): number | null {
  return parseIntId(customId, REPORT_DISMISS_PREFIX);
}

export function buildRemoveTimeoutId(userId: string): string {
  return `${REMOVE_TIMEOUT_PREFIX}${userId}`;
}

export function parseRemoveTimeoutId(customId: string): string | null {
  return customId.startsWith(REMOVE_TIMEOUT_PREFIX)
    ? customId.slice(REMOVE_TIMEOUT_PREFIX.length)
    : null;
}
