import type { MessageCreateOptions } from "discord.js";
import {
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} from "discord.js";

import Color from "@/utils/colors";

import type {
  ReactionBatch,
  ReactionEvent,
} from "../../domain/types/ReactionEvent";

/**
 * Creates a reaction log message using Components v2 for better visual hierarchy
 * and improved readability. Handles both additions and removals with clear sections.
 */
export function createReactionLogMessage(
  batch: ReactionBatch,
): MessageCreateOptions {
  const container = new ContainerBuilder().setAccentColor(
    getReactionLogColor(batch.actions),
  );

  // Build message sections
  const summarySection = buildReactionSummarySection(batch);
  container.addTextDisplayComponents(summarySection);

  const emojiGroups = groupByEmoji(batch.actions);
  const addGroups = emojiGroups.filter((group) => group.adds.length > 0);
  const removeGroups = emojiGroups.filter((group) => group.removes.length > 0);

  // Add sections with separators
  if (addGroups.length > 0) {
    container.addSeparatorComponents(new SeparatorBuilder());
    const addedSection = buildAddedReactionsSection(addGroups);
    container.addTextDisplayComponents(addedSection);
  }

  if (removeGroups.length > 0) {
    container.addSeparatorComponents(new SeparatorBuilder());
    const removedSection = buildRemovedReactionsSection(removeGroups);
    container.addTextDisplayComponents(removedSection);
  }

  // Add time info
  container.addSeparatorComponents(new SeparatorBuilder());
  const timeSection = buildTimeInfoSection(batch);
  container.addTextDisplayComponents(timeSection);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

function buildReactionSummarySection(batch: ReactionBatch): TextDisplayBuilder {
  const messageLink = `https://discord.com/channels/${batch.guildId}/${batch.channelId}/${batch.messageId}`;

  let content = "### Reaction Activity\n";
  content += `**Message:** ${messageLink}\n`;

  // Add spam detection warning if applicable
  const hasSpamPattern = hasQuickTogglePattern(batch.actions);
  if (hasSpamPattern) {
    content += "⚠️ **Repeated reaction multiple times**\n";
  }

  return new TextDisplayBuilder().setContent(content);
}

function buildAddedReactionsSection(
  addGroups: EmojiGroup[],
): TextDisplayBuilder {
  let content = "### Added Reactions\n";

  for (const group of addGroups) {
    const groupContent = formatEmojiGroup(group, "add");
    content += `${groupContent}\n`;
  }

  return new TextDisplayBuilder().setContent(content);
}

function buildRemovedReactionsSection(
  removeGroups: EmojiGroup[],
): TextDisplayBuilder {
  let content = "### Removed Reactions\n";

  for (const group of removeGroups) {
    const groupContent = formatEmojiGroup(group, "remove");
    content += `${groupContent}\n`;
  }

  return new TextDisplayBuilder().setContent(content);
}

function buildTimeInfoSection(batch: ReactionBatch): TextDisplayBuilder {
  const endTime = new Date();
  const startTime = batch.startTime.getTime() / 1000;
  const endTimeStr = endTime.getTime() / 1000;

  const timeInfo =
    startTime !== endTimeStr
      ? `<t:${startTime}:f> – <t:${endTimeStr}:f>`
      : `<t:${startTime}:f>`;

  return new TextDisplayBuilder().setContent(timeInfo);
}

function getReactionLogColor(actions: ReactionEvent[]): number {
  const emojiGroups = groupByEmoji(actions);
  const hasRemovals = emojiGroups.some((group) => group.removes.length > 0);
  const hasQuickToggles = hasQuickTogglePattern(actions);

  if (hasQuickToggles) {
    return Color.Warning; // Yellow for potential spam
  }
  if (hasRemovals) {
    return Color.Error; // Red/pink for removals
  }
  return Color.Info; // Default blue
}

interface EmojiGroup {
  emoji: string;
  adds: ReactionEvent[];
  removes: ReactionEvent[];
}

function groupByEmoji(actions: ReactionEvent[]): EmojiGroup[] {
  const emojiMap = new Map<string, EmojiGroup>();

  for (const action of actions) {
    const group = getOrCreateEmojiGroup(emojiMap, action.emoji);

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
  emoji: string,
): EmojiGroup {
  if (!emojiMap.has(emoji)) {
    emojiMap.set(emoji, {
      emoji,
      adds: [],
      removes: [],
    });
  }

  const group = emojiMap.get(emoji);
  if (!group) {
    throw new Error(`Emoji group not found for emoji: ${emoji}`);
  }

  return group;
}

function formatEmojiGroup(group: EmojiGroup, type: "add" | "remove"): string {
  const reactions = type === "add" ? group.adds : group.removes;
  if (reactions.length === 0) return "";

  const formattedUsers = formatReactionUsers(reactions, type === "add");
  return `- ${group.emoji} ${formattedUsers}`;
}

function formatReactionUsers(
  reactions: ReactionEvent[],
  isAddType: boolean,
): string {
  const starter = reactions.find((action) => action.isInitial);
  const others = reactions.filter((action) => !action.isInitial);

  const formatUser = (action: ReactionEvent, isStarter = false): string => {
    return isStarter ? `<@${action.userId}> (starter)` : `<@${action.userId}>`;
  };

  const userStrings: string[] = [];

  if (starter) {
    userStrings.push(formatUser(starter, isAddType));
  }

  if (others.length > 0) {
    const otherUserStrings = others.map((action) => formatUser(action));
    userStrings.push(...otherUserStrings);
  }

  return userStrings.join(", ");
}

function hasQuickTogglePattern(actions: ReactionEvent[]): boolean {
  const RAPID_TOGGLE_THRESHOLD_MS = 10000; // 10 seconds
  const MIN_TOGGLE_COUNT = 3;

  // Group actions by user and emoji
  const userEmojiGroups = groupActionsByUserAndEmoji(actions);

  // Check each user-emoji combination for rapid toggles
  for (const userActions of userEmojiGroups.values()) {
    if (
      hasRapidToggles(userActions, MIN_TOGGLE_COUNT, RAPID_TOGGLE_THRESHOLD_MS)
    ) {
      return true;
    }
  }

  return false;
}

function groupActionsByUserAndEmoji(
  actions: ReactionEvent[],
): Map<string, ReactionEvent[]> {
  const groups = new Map<string, ReactionEvent[]>();

  for (const action of actions) {
    const key = `${action.userId}-${action.emoji}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    const group = groups.get(key);
    if (group) {
      group.push(action);
    }
  }

  return groups;
}

function hasRapidToggles(
  userActions: ReactionEvent[],
  minToggleCount: number,
  thresholdMs: number,
): boolean {
  if (userActions.length < minToggleCount) {
    return false;
  }

  // Sort by timestamp
  const sortedActions = [...userActions].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  );

  // Check for rapid sequences
  for (let i = 0; i <= sortedActions.length - minToggleCount; i++) {
    const timeSpan =
      sortedActions[i + minToggleCount - 1].timestamp.getTime() -
      sortedActions[i].timestamp.getTime();

    if (timeSpan < thresholdMs) {
      return true;
    }
  }

  return false;
}
