import type { HelpAudience } from "../domain/helpCatalog";
import { HELP_AUDIENCES } from "../domain/helpCatalog";

const TAB_PREFIX = "help:tab:";

export function helpTabId(audience: HelpAudience): string {
  return `${TAB_PREFIX}${audience}`;
}

export function parseHelpTabId(customId: string): HelpAudience | null {
  if (!customId.startsWith(TAB_PREFIX)) {
    return null;
  }

  const audience = customId.slice(TAB_PREFIX.length);
  return HELP_AUDIENCES.find((a) => a === audience) ?? null;
}
