import type { ScreeningGuildSettings } from "./types";

export function isScreeningActive(
  flagOn: boolean,
  settings: ScreeningGuildSettings | null,
): boolean {
  return (
    flagOn &&
    settings !== null &&
    settings.enabled &&
    settings.logChannelId !== null
  );
}
