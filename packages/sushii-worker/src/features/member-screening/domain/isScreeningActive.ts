import type { ActiveScreeningSettings, ScreeningGuildSettings } from "./types";

export function isScreeningActive(
  flagOn: boolean,
  settings: ScreeningGuildSettings | null,
): settings is ActiveScreeningSettings {
  return (
    flagOn &&
    settings !== null &&
    settings.enabled &&
    settings.logChannelId !== null
  );
}
