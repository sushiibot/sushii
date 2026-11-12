import {
  ChannelType,
  DiscordAPIError,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
} from "discord.js";
import type { GuildMember } from "discord.js";
import type { Logger } from "pino";

export interface ViewerAccess {
  /** Resolves private-thread membership; private threads not prepared or cached are denied. */
  prepare(channelIds: Iterable<string>): Promise<void>;
  canView(channelId: string): boolean;
  /** ViewChannel + ReadMessageHistory. */
  canRead(channelId: string): boolean;
  channelName(channelId: string): string | null;
}

/** Current permissions; unknown channels (deleted, uncached threads) are denied. */
export function viewerAccessFromMember(
  member: GuildMember,
  logger?: Logger,
): ViewerAccess {
  const threadMembership = new Map<string, boolean>();

  const resolve = (channelId: string) =>
    member.guild.channels.resolve(channelId);

  const privateThread = (channelId: string) => {
    const channel = resolve(channelId);
    return channel?.type === ChannelType.PrivateThread ? channel : null;
  };

  const has = (channelId: string, perms: bigint[]): boolean => {
    const channel = resolve(channelId);
    if (!channel) {
      return false;
    }

    // permissionsIn(thread) returns the parent's permissions, which ignores private-thread membership.
    const permissions = member.permissionsIn(channel);
    if (!(permissions?.has(perms) ?? false)) {
      return false;
    }

    if (channel.type !== ChannelType.PrivateThread) {
      return true;
    }

    if (permissions.has(PermissionFlagsBits.ManageThreads)) {
      return true;
    }

    return (
      channel.members.cache.has(member.id) ||
      threadMembership.get(channelId) === true
    );
  };

  return {
    prepare: async (channelIds) => {
      const threads = [...new Set(channelIds)].flatMap((id) => {
        const thread = privateThread(id);
        return thread &&
          !threadMembership.has(id) &&
          !thread.members.cache.has(member.id)
          ? [thread]
          : [];
      });

      await Promise.all(
        threads.map(async (thread) => {
          try {
            await thread.members.fetch({ member: member.id });
            threadMembership.set(thread.id, true);
          } catch (err) {
            // Unknown Member means not in the thread; any other failure also denies.
            threadMembership.set(thread.id, false);
            if (
              !(err instanceof DiscordAPIError) ||
              err.code !== RESTJSONErrorCodes.UnknownMember
            ) {
              logger?.warn(
                { err, threadId: thread.id, memberId: member.id },
                "Could not check thread membership for suggested proof",
              );
            }
          }
        }),
      );
    },
    canView: (channelId) => has(channelId, [PermissionFlagsBits.ViewChannel]),
    canRead: (channelId) =>
      has(channelId, [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
      ]),
    channelName: (channelId) => resolve(channelId)?.name ?? null,
  };
}
