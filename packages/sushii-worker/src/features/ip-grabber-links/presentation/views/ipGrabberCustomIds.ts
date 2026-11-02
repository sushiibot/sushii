const REVERT_PREFIX = "ip_grabber:revert:";

export function buildRevertId(hostname: string): string {
  return `${REVERT_PREFIX}${hostname}`;
}

export function parseRevertId(customId: string): string | null {
  return customId.startsWith(REVERT_PREFIX)
    ? customId.slice(REVERT_PREFIX.length)
    : null;
}
