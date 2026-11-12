import type { MessageData } from "@/features/message-log/domain/types/MessageData";

export interface CachedMessage {
  id: string;
  channelId: string;
  authorId: string;
  interactionUserId: string | null;
  createdAt: Date;
  content: string;
  msg: MessageData;
}

export interface TimeRange {
  from: Date;
  to: Date;
}

/**
 * Read-only queries over the message cache. Ranges are inclusive.
 * "Target messages" are the target's non-AutoMod messages, authored or app replies they triggered.
 */
export interface ProofSuggestionMessageRepository {
  /** Log channels holding posts for the target's deleted messages in the range. */
  findTargetLogChannelIds(
    guildId: string,
    targetId: string,
    range: TimeRange,
  ): Promise<string[]>;

  /** Excludes messages logged to `hiddenLogChannelIds`. */
  countTargetMessagesByChannel(
    guildId: string,
    targetId: string,
    range: TimeRange,
    hiddenLogChannelIds: string[],
  ): Promise<Map<string, number>>;

  /** Newest first; excludes messages logged to `hiddenLogChannelIds`. */
  findLatestTargetMessages(
    guildId: string,
    targetId: string,
    range: TimeRange,
    channelIds: string[],
    hiddenLogChannelIds: string[],
    limit: number,
  ): Promise<CachedMessage[]>;

  /** Type-24 AutoMod alerts authored by the target, newest first. */
  findTargetAutomodAlerts(
    guildId: string,
    targetId: string,
    range: TimeRange,
    limit: number,
  ): Promise<CachedMessage[]>;

  findByIds(guildId: string, messageIds: string[]): Promise<CachedMessage[]>;

  /** Others' non-AutoMod messages in one channel, newest first. */
  findOthersInChannel(
    guildId: string,
    channelId: string,
    targetId: string,
    range: TimeRange,
    limit: number,
  ): Promise<CachedMessage[]>;
}
