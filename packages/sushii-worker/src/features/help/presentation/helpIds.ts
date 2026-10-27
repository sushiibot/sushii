import type { HelpAudience } from "../domain/helpCatalog";
import { HELP_AUDIENCES } from "../domain/helpCatalog";

const TAB_PREFIX = "help:tab:";

export interface HelpTabTarget {
  audience: HelpAudience;
  /** Null on tabs from private /help replies, which only their owner can click. */
  ownerId: string | null;
}

export function helpTabId(audience: HelpAudience, ownerId: string): string {
  return `${TAB_PREFIX}${audience}:${ownerId}`;
}

export function parseHelpTabId(customId: string): HelpTabTarget | null {
  if (!customId.startsWith(TAB_PREFIX)) {
    return null;
  }

  const [audienceId, ownerId, ...rest] = customId
    .slice(TAB_PREFIX.length)
    .split(":");
  const audience = HELP_AUDIENCES.find((a) => a === audienceId);
  if (!audience || rest.length > 0 || ownerId === "") {
    return null;
  }

  return { audience, ownerId: ownerId ?? null };
}
