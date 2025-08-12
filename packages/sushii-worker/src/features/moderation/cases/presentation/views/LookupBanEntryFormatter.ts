import type { UserLookupBan } from "@/features/moderation/cases/domain/entities/UserLookupBan";
import SushiiEmoji from "@/shared/presentation/SushiiEmoji";
import timestampToUnixTime from "@/utils/timestampToUnixTime";

/**
 * Format a single ban entry for display in lookup views.
 * Only shows server names and reasons when BOTH guilds have opted in.
 */
export function formatBanEntry(
  ban: UserLookupBan,
  currentGuildOptIn: boolean,
): string {
  const shouldShowDetails = ban.lookupDetailsOptIn && currentGuildOptIn;
  const parts: string[] = [];

  // Always show guild badges (even for hidden names, gives context about server type)
  const guildBadges = getGuildBadges(ban.guildFeatures || []);
  
  if (shouldShowDetails && ban.guildName) {
    // Both guilds opted in - show real server name
    const escapedGuildName = escapeMarkdown(ban.guildName);
    parts.push(`${guildBadges} **${escapedGuildName}**`);
  } else {
    // Either guild hasn't opted in - hide server name
    parts.push(`${guildBadges} **[Server Name Hidden]**`);
  }

  if (ban.actionTime) {
    const timestamp = timestampToUnixTime(ban.actionTime.getTime());
    parts.push(`<t:${timestamp}:R>`);
  }

  const header = parts.join(" – ");
  let entry = header;

  // Only show reason if both guilds opted in
  if (shouldShowDetails && ban.reason) {
    entry += `\n> ${ban.reason}`;
  }

  return entry;
}

/**
 * Get guild feature badges based on Discord guild features.
 * Returns badges with trailing space if any exist, empty string otherwise.
 */
export function getGuildBadges(guildFeatures: string[]): string {
  const badges: string[] = [];

  if (guildFeatures.includes("VERIFIED")) {
    badges.push(SushiiEmoji.VerifiedIcon);
  }

  if (guildFeatures.includes("PARTNERED")) {
    badges.push(SushiiEmoji.PartnerIcon);
  }

  if (guildFeatures.includes("DISCOVERABLE")) {
    badges.push(SushiiEmoji.DiscoverableIcon);
  }

  return badges.length > 0 ? badges.join(" ") : "";
}

/**
 * Escape markdown special characters to prevent formatting issues.
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/([*_`~|\\])/g, "\\$1");
}