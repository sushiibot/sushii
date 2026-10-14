import type { RESTGetAPIGuildRoleMemberCountsResult } from "discord-api-types/v10";
import type { Collection, Guild, GuildMember } from "discord.js";
import { Routes } from "discord.js";
import type { Logger } from "pino";

import type {
  AuditMemberSource,
  ResolvedMembers,
} from "../application/PermissionAuditService";

/** Discord's limit for one Request Guild Members by user ID. */
export const MAX_RESOLVED_MEMBERS = 100;
const FETCH_TIMEOUT_MS = 15_000;

export class DiscordAuditMemberSource implements AuditMemberSource {
  constructor(private readonly logger: Logger) {}

  async roleMemberCounts(guild: Guild): Promise<Map<string, number>> {
    const counts = (await guild.client.rest.get(
      Routes.guildRoleMemberCounts(guild.id),
    )) as RESTGetAPIGuildRoleMemberCountsResult;

    return new Map(Object.entries(counts));
  }

  async membersById(
    guild: Guild,
    userIds: readonly string[],
  ): Promise<ResolvedMembers> {
    const requested = userIds.slice(0, MAX_RESOLVED_MEMBERS);
    const unresolvedIds = new Set(userIds.slice(MAX_RESOLVED_MEMBERS));
    if (requested.length === 0) {
      return { members: new Map(), unresolvedIds };
    }

    let members: Collection<string, GuildMember>;
    try {
      members = await guild.members.fetch({
        user: requested,
        time: FETCH_TIMEOUT_MS,
      });
    } catch (err) {
      // Unresolved users count as using their permissions, so the report stays safe.
      this.logger.warn(
        { err, guildId: guild.id, count: requested.length },
        "Failed to fetch permission audit members",
      );
      return {
        members: new Map(),
        unresolvedIds: new Set(userIds),
      };
    }

    // Requested but not returned: no longer in the guild.
    return { members, unresolvedIds };
  }
}
