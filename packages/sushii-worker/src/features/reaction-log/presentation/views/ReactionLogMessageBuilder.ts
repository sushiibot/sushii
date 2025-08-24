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
import { formatEmojiWithUrl } from "../../shared/utils/EmojiFormatter";

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

    // Add message link as its own line
    content += `${messageLink}\n`;

    // Format each emoji removal for this message as indented bullets
    for (const group of emojiGroups) {
      if (group.removes.length > 0) {
        const formattedEmoji = formatEmojiWithUrl(group);
        const removalInfo = formatGuildRemovalUsers(group.removes);
        content += `- ${formattedEmoji} removed by ${removalInfo}\n`;
      }
    }
  }

  return new TextDisplayBuilder().setContent(content);
}

interface UserCategories {
  removers: Map<string, number>;
  allStarters: string[];
  startersSet: Set<string>;
  removersSet: Set<string>;
  nonRemovingStarters: string[];
}

function categorizeUsers(removals: ReactionEvent[]): UserCategories {
  const removers = new Map<string, number>();
  let allStarters: string[] = [];

  for (const removal of removals) {
    removers.set(removal.userId, (removers.get(removal.userId) || 0) + 1);
    if (removal.allStarters && allStarters.length === 0) {
      allStarters = removal.allStarters;
    }
  }

  const startersSet = new Set(allStarters);
  const removersSet = new Set(removers.keys());
  const nonRemovingStarters = allStarters.filter(
    (starterId) => !removersSet.has(starterId),
  );

  return {
    removers,
    allStarters,
    startersSet,
    removersSet,
    nonRemovingStarters,
  };
}

function formatUser(userId: string): string {
  return `<@${userId}> – \`${userId}\``;
}

function formatUserMention(
  userId: string,
  count: number,
  isStarter = false,
): string {
  const mention = formatUser(userId);
  const countSuffix = count > 1 ? ` x${count}` : "";
  const starterSuffix = isStarter ? " (started)" : "";
  return `${mention}${countSuffix}${starterSuffix}`;
}

function formatGuildRemovalUsers(removals: ReactionEvent[]): string {
  const categories = categorizeUsers(removals);

  const userStrings: string[] = [];

  // Add users who removed reactions, marking starters
  userStrings.push(...formatRemovers(categories));

  // Add starter context for non-removing starters
  const starterContext = formatStarterContext(categories);
  if (starterContext) {
    userStrings.push(starterContext);
  }

  return userStrings.join(", ");
}

function formatRemovers(categories: UserCategories): string[] {
  const userStrings: string[] = [];

  for (const [userId, count] of categories.removers) {
    const isStarter = categories.startersSet.has(userId);
    userStrings.push(formatUserMention(userId, count, isStarter));
  }

  return userStrings;
}

function formatStarterContext(categories: UserCategories): string | null {
  const { allStarters, nonRemovingStarters } = categories;

  if (nonRemovingStarters.length > 0) {
    return formatNonRemovingStarters(allStarters, nonRemovingStarters);
  } else if (allStarters.length > 1) {
    // All starters removed their reactions - show full starter chain for context
    return formatStarterChain(allStarters[0], allStarters.slice(1));
  }

  return null;
}

function formatNonRemovingStarters(
  allStarters: string[],
  nonRemovingStarters: string[],
): string {
  if (allStarters.length === 1) {
    // Single starter who didn't remove
    return `(started by ${formatUser(nonRemovingStarters[0])})`;
  }

  // Multiple starters - show with re-started format
  const firstStarter = allStarters[0];
  const reStarters = allStarters.slice(1);

  if (nonRemovingStarters.includes(firstStarter)) {
    const nonRemovingReStarters = reStarters.filter((id) =>
      nonRemovingStarters.includes(id),
    );

    if (nonRemovingReStarters.length > 0) {
      return formatStarterChain(firstStarter, nonRemovingReStarters);
    } else {
      return `(started by ${formatUser(firstStarter)})`;
    }
  } else {
    // First starter removed, show remaining non-removing re-starters
    const mentions = nonRemovingStarters.map((id) => formatUser(id)).join(", ");
    return `(re-started by ${mentions})`;
  }
}

function formatStarterChain(
  firstStarter: string,
  reStarters: string[],
): string {
  const restarterMentions = reStarters.map((id) => formatUser(id)).join(", ");
  return `(started by ${formatUser(firstStarter)}; re-started by ${restarterMentions})`;
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
