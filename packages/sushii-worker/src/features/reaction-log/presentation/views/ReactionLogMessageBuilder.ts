import type { MessageCreateOptions } from "discord.js";
import {
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} from "discord.js";

import Color from "@/utils/colors";

import type {
  GuildReactionBatch,
  ReactionEvent,
} from "../../domain/types/ReactionEvent";
import { BATCH_WINDOW_MS } from "../../domain/types/ReactionEvent";

/**
 * Creates a guild reaction log message for removal-only batches
 * Groups removals from multiple messages into a single log
 */

interface EmojiGroup {
  emojiString: string;
  emojiId?: string;
  emojiName?: string;
  adds: ReactionEvent[];
  removes: ReactionEvent[];
}

function groupByEmoji(actions: ReactionEvent[]): EmojiGroup[] {
  const emojiMap = new Map<string, EmojiGroup>();

  for (const action of actions) {
    const group = getOrCreateEmojiGroup(emojiMap, action);

    if (action.type === "add") {
      group.adds.push(action);
    } else {
      group.removes.push(action);
    }
  }

  return Array.from(emojiMap.values());
}

function getOrCreateEmojiGroup(
  emojiMap: Map<string, EmojiGroup>,
  action: ReactionEvent,
): EmojiGroup {
  if (!emojiMap.has(action.emojiString)) {
    emojiMap.set(action.emojiString, {
      emojiString: action.emojiString,
      emojiId: action.emojiId,
      emojiName: action.emojiName,
      adds: [],
      removes: [],
    });
  }

  const group = emojiMap.get(action.emojiString);
  if (!group) {
    throw new Error(`Emoji group not found for emoji: ${action.emojiString}`);
  }

  return group;
}

function formatEmojiWithUrl(group: EmojiGroup): string {
  // For custom emojis, include the ID and image URL
  if (group.emojiId && group.emojiName) {
    const isAnimated = group.emojiString.startsWith("<a:");
    const extension = isAnimated ? "gif" : "png";
    const imageUrl = `https://cdn.discordapp.com/emojis/${group.emojiId}.${extension}`;
    return `${group.emojiString} – [${group.emojiName}](${imageUrl})`;
  }

  // For Unicode emojis, just return the emoji
  return group.emojiString;
}

/**
 * Creates a guild reaction log message for removal-only batches
 * Groups removals from multiple messages into a single log
 */
export function createGuildReactionLogMessage(
  guildBatch: GuildReactionBatch,
): MessageCreateOptions {
  const container = new ContainerBuilder().setAccentColor(Color.Error); // Always red for removals

  // Build header section
  const headerSection = buildGuildBatchHeaderSection(guildBatch);
  container.addTextDisplayComponents(headerSection);

  // Group removals by message
  const messageRemovals = Array.from(guildBatch.removals.entries());

  if (messageRemovals.length > 0) {
    container.addSeparatorComponents(new SeparatorBuilder());
    const removalSection = buildGuildRemovalSection(messageRemovals);
    container.addTextDisplayComponents(removalSection);
  }

  // Add time info
  container.addSeparatorComponents(new SeparatorBuilder());
  const timeSection = buildGuildBatchTimeInfoSection(guildBatch);
  container.addTextDisplayComponents(timeSection);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

function buildGuildBatchHeaderSection(
  guildBatch: GuildReactionBatch,
): TextDisplayBuilder {
  const messagesText =
    guildBatch.removals.size === 1
      ? "1 message"
      : `${guildBatch.removals.size} messages`;

  const content = `### Reactions Removed (${messagesText})`;
  return new TextDisplayBuilder().setContent(content);
}

function buildGuildRemovalSection(
  messageRemovals: [string, ReactionEvent[]][],
): TextDisplayBuilder {
  let content = "";

  for (const [messageId, events] of messageRemovals) {
    // Group events by emoji for this message
    const emojiGroups = groupByEmoji(events);

    // Get channel info from first event
    const firstEvent = events[0];
    const messageLink = `https://discord.com/channels/${firstEvent.guildId}/${firstEvent.channelId}/${messageId}`;

    // Format each emoji removal for this message
    for (const group of emojiGroups) {
      if (group.removes.length > 0) {
        const formattedEmoji = formatEmojiWithUrl(group);
        const removalInfo = formatGuildRemovalUsers(group.removes);
        content += `- ${messageLink} - ${formattedEmoji} removed by ${removalInfo}\n`;
      }
    }
  }

  return new TextDisplayBuilder().setContent(content);
}

function formatGuildRemovalUsers(removals: ReactionEvent[]): string {
  // Count occurrences per user and track starter
  const userCounts = new Map<string, number>();
  let starterId: string | undefined;

  for (const removal of removals) {
    userCounts.set(removal.userId, (userCounts.get(removal.userId) || 0) + 1);
    if (removal.isInitial) {
      starterId = removal.userId;
    }
  }

  const formatUser = (
    userId: string,
    count: number,
    isStarter = false,
  ): string => {
    const mention = `<@${userId}>`;
    const countSuffix = count > 1 ? ` x${count}` : "";
    const starterSuffix = isStarter ? " (started)" : "";
    return `${mention}${countSuffix}${starterSuffix}`;
  };

  const userStrings: string[] = [];

  // Add users, marking the starter
  for (const [userId, count] of userCounts) {
    const isStarter = userId === starterId;
    userStrings.push(formatUser(userId, count, isStarter));
  }

  // Add starter info if they didn't remove their reaction
  if (starterId && !userCounts.has(starterId)) {
    userStrings.push(`(started by <@${starterId}>)`);
  }

  return userStrings.join(", ");
}

function buildGuildBatchTimeInfoSection(
  guildBatch: GuildReactionBatch,
): TextDisplayBuilder {
  const endTime = new Date();
  const startTime = Math.floor(guildBatch.startTime.getTime() / 1000);
  const endTimeStr = Math.floor(endTime.getTime() / 1000);

  // Guild batches are always processed after the batch window timeout
  const durationText = `${BATCH_WINDOW_MS / 1000} seconds`;

  const timeInfo =
    startTime !== endTimeStr
      ? `<t:${startTime}:T> – <t:${endTimeStr}:T> (${durationText})`
      : `<t:${startTime}:T> (${durationText})`;

  return new TextDisplayBuilder().setContent(timeInfo);
}
