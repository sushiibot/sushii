import type { Guild } from "discord.js";
import { GuildFeature } from "discord.js";

import { config } from "@/shared/infrastructure/config";

const MINIMUM_MEMBER_COUNT = 1000;

/**
 * Validates whether a guild meets the requirements to access cross-server lookup features.
 *
 * A guild is considered "public" if it meets any of these criteria:
 * - Guild ID is in the exempt list (configurable via LOOKUP_EXEMPT_GUILD_IDS)
 * - Guild has the PARTNERED feature
 * - Guild has the VERIFIED feature
 * - Guild has the DISCOVERABLE feature AND at least 1000 members
 *
 * @param guild - The Discord guild to validate
 * @returns true if the guild meets public server requirements, false otherwise
 */
export function isPublicServer(guild: Guild): boolean {
  const isExemptGuild = config.deployment.lookupExemptGuildIds.has(guild.id);
  const isDiscoverable = guild.features.includes(GuildFeature.Discoverable);
  const isPartnered = guild.features.includes(GuildFeature.Partnered);
  const isVerified = guild.features.includes(GuildFeature.Verified);
  const hasEnoughMembers = guild.memberCount >= MINIMUM_MEMBER_COUNT;

  // Allow if exempt, partnered, or verified
  if (isExemptGuild || isPartnered || isVerified) {
    return true;
  }

  // Otherwise must be discoverable with enough members
  return isDiscoverable && hasEnoughMembers;
}
