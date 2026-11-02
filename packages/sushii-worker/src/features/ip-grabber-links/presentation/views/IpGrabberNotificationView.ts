import type { SushiiNotification } from "@/shared/infrastructure/SushiiNotificationService";

import type { IpGrabberSyncError } from "../../domain/IpGrabberRepository";
import { MAX_RULE_KEYWORDS } from "../../domain/keywords";

const SETTINGS_PATH = "/settings → Automod → IP grabber links";

export function syncErrorNotification(
  error: IpGrabberSyncError,
  ruleName: string | null,
): SushiiNotification {
  const rule = ruleName ? `**${ruleName}**` : "your AutoMod rule";

  switch (error) {
    case "rule_missing":
      return {
        severity: "warning",
        title: "IP grabber links stopped",
        body: `The AutoMod rule ${rule} was deleted, so sushii can't add IP grabber domains anymore.`,
        hint: `Pick another keyword rule in ${SETTINGS_PATH}.`,
      };
    case "rule_full":
      return {
        severity: "warning",
        title: "IP grabber links couldn't update",
        body: `${rule} would go over Discord's limit of ${MAX_RULE_KEYWORDS.toLocaleString("en-US")} keywords, so nothing was changed.`,
        hint: `Remove some keywords from the rule, or pick a rule with more room in ${SETTINGS_PATH}.`,
      };
    case "missing_permission":
      return {
        severity: "warning",
        title: "IP grabber links couldn't update",
        body: "sushii is missing the **Manage Server** permission, which Discord requires to edit AutoMod rules.",
        hint: "Give sushii Manage Server, and the next sync will catch up.",
      };
  }
}
