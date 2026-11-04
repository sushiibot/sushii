import type { ModLogRepository } from "@/features/moderation/shared/domain/repositories/ModLogRepository";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

/** The mod log entry of a response's first case, or null when it has none. */
export type ModLogUrlResolver = (
  guildId: string,
  caseIds: string[],
) => Promise<string | null>;

/** Uses the current mod log channel; entries posted to an older channel get a dead link. */
export function modLogEntryUrl(
  guildId: string,
  channelId: string | null,
  messageId: string | null,
): string | null {
  return channelId && messageId
    ? `https://discord.com/channels/${guildId}/${channelId}/${messageId}`
    : null;
}

export function createModLogUrlResolver(deps: {
  modLogRepository: Pick<ModLogRepository, "findByIds">;
  guildConfigRepository: Pick<GuildConfigRepository, "findByGuildId">;
}): ModLogUrlResolver {
  return async (guildId, caseIds) => {
    const [firstId] = caseIds;
    if (!firstId) {
      return null;
    }
    const [cases, config] = await Promise.all([
      deps.modLogRepository.findByIds(guildId, [firstId]),
      deps.guildConfigRepository.findByGuildId(guildId),
    ]);
    return modLogEntryUrl(
      guildId,
      config.loggingSettings.modLogChannel,
      cases[0]?.msgId ?? null,
    );
  };
}
