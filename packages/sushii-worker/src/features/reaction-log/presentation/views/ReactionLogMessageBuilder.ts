import { EmbedBuilder } from "discord.js";

import Color from "@/utils/colors";

import type {
  ReactionBatch,
  ReactionEvent,
} from "../../domain/types/ReactionEvent";

export function createReactionLogMessage(batch: ReactionBatch): {
  embeds: EmbedBuilder[];
} {
  const emojiGroups = groupByEmoji(batch.actions);
  const embeds = createMultipleEmbeds(batch, emojiGroups);
  return { embeds };
}

function createMultipleEmbeds(
  batch: ReactionBatch,
  emojiGroups: EmojiGroup[],
): EmbedBuilder[] {
  const MAX_DESCRIPTION_LENGTH = 4096;
  const embeds: EmbedBuilder[] = [];

  // Base header and footer content
  const header = `📊 Reaction Activity\n`;
  const messageLink = `https://discord.com/channels/${batch.guildId}/${batch.channelId}/${batch.messageId}\n\n`;

  const endTime = new Date();
  const startTime = batch.startTime.toLocaleTimeString();
  const endTimeStr = endTime.toLocaleTimeString();

  const timeInfo =
    startTime !== endTimeStr
      ? `Time: ${startTime} - ${endTimeStr}`
      : `Time: ${startTime}`;

  // Separate adds and removes
  const addGroups = emojiGroups.filter((group) => group.adds.length > 0);
  const removeGroups = emojiGroups.filter((group) => group.removes.length > 0);

  // Calculate base content size (header, link, time, section headers) - for future use
  const _baseContentSize =
    header.length +
    messageLink.length +
    timeInfo.length +
    (addGroups.length > 0 ? "✅ Added:\n\n".length : 0) +
    (removeGroups.length > 0 ? "❌ Removed:\n\n".length : 0);

  let currentDescription = header + messageLink;
  let currentContentSize = header.length + messageLink.length;
  let isFirstEmbed = true;

  // Process adds first
  if (addGroups.length > 0) {
    const addsHeader = "✅ Added:\n";

    if (
      currentContentSize + addsHeader.length + timeInfo.length <
      MAX_DESCRIPTION_LENGTH
    ) {
      currentDescription += addsHeader;
      currentContentSize += addsHeader.length;
    }

    for (const group of addGroups) {
      const groupContent = formatEmojiGroup(group, "add");
      const groupSize = groupContent.length + 1; // +1 for newline

      // Check if we need to start a new embed
      if (
        currentContentSize + groupSize + timeInfo.length + 2 >
        MAX_DESCRIPTION_LENGTH
      ) {
        // Finish current embed
        currentDescription += "\n" + timeInfo;
        embeds.push(
          createEmbed(currentDescription, batch.actions, isFirstEmbed),
        );

        // Start new embed
        currentDescription =
          `📊 Reaction Activity (Continued)\n` +
          messageLink +
          addsHeader +
          groupContent;
        currentContentSize = currentDescription.length;
        isFirstEmbed = false;
      } else {
        currentDescription += groupContent + "\n";
        currentContentSize += groupSize;
      }
    }
  }

  // Process removes
  if (removeGroups.length > 0) {
    const removesHeader = "\n❌ Removed:\n";

    if (
      currentContentSize + removesHeader.length + timeInfo.length <
      MAX_DESCRIPTION_LENGTH
    ) {
      currentDescription += removesHeader;
      currentContentSize += removesHeader.length;
    } else {
      // Need new embed for removes
      currentDescription += "\n" + timeInfo;
      embeds.push(createEmbed(currentDescription, batch.actions, isFirstEmbed));

      currentDescription =
        `📊 Reaction Activity (Continued)\n` + messageLink + "❌ Removed:\n";
      currentContentSize = currentDescription.length;
      isFirstEmbed = false;
    }

    for (const group of removeGroups) {
      const groupContent = formatEmojiGroup(group, "remove");
      const groupSize = groupContent.length + 1; // +1 for newline

      // Check if we need to start a new embed
      if (
        currentContentSize + groupSize + timeInfo.length + 2 >
        MAX_DESCRIPTION_LENGTH
      ) {
        // Finish current embed
        currentDescription += "\n" + timeInfo;
        embeds.push(
          createEmbed(currentDescription, batch.actions, isFirstEmbed),
        );

        // Start new embed
        currentDescription =
          `📊 Reaction Activity (Continued)\n` +
          messageLink +
          "❌ Removed:\n" +
          groupContent;
        currentContentSize = currentDescription.length;
        isFirstEmbed = false;
      } else {
        currentDescription += groupContent + "\n";
        currentContentSize += groupSize;
      }
    }
  }

  // Finish the final embed
  currentDescription += "\n" + timeInfo;
  embeds.push(createEmbed(currentDescription, batch.actions, isFirstEmbed));

  return embeds;
}

function createEmbed(
  description: string,
  actions: ReactionEvent[],
  isFirstEmbed: boolean,
): EmbedBuilder {
  // Determine embed color based on activity (only for first embed)
  let color = Color.Info; // Default blue

  if (isFirstEmbed) {
    const emojiGroups = groupByEmoji(actions);
    const hasRemovals = emojiGroups.some((group) => group.removes.length > 0);
    const hasQuickToggles = hasQuickTogglePattern(actions);

    if (hasQuickToggles) {
      color = Color.Warning; // Yellow for potential spam
    } else if (hasRemovals) {
      color = Color.Error; // Red/pink for removals
    }
  }

  return new EmbedBuilder()
    .setDescription(description)
    .setColor(color)
    .setTimestamp();
}

interface EmojiGroup {
  emoji: string;
  adds: ReactionEvent[];
  removes: ReactionEvent[];
}

function groupByEmoji(actions: ReactionEvent[]): EmojiGroup[] {
  const groups = new Map<string, EmojiGroup>();

  for (const action of actions) {
    if (!groups.has(action.emoji)) {
      groups.set(action.emoji, {
        emoji: action.emoji,
        adds: [],
        removes: [],
      });
    }

    const group = groups.get(action.emoji);
    if (!group) {
      continue;
    }

    if (action.type === "add") {
      group.adds.push(action);
    } else {
      group.removes.push(action);
    }
  }

  return Array.from(groups.values());
}

function formatEmojiGroup(group: EmojiGroup, type: "add" | "remove"): string {
  const reactions = type === "add" ? group.adds : group.removes;
  if (reactions.length === 0) return "";

  let line = `  ${group.emoji} - `;

  if (type === "add") {
    const starter = reactions.find((action) => action.isInitial);
    const others = reactions.filter((action) => !action.isInitial);

    if (starter) {
      const username = starter.userName || `<@${starter.userId}>`;
      line += `${username} (started)`;

      if (others.length > 0) {
        const otherUsers = others.map(
          (action) => action.userName || `<@${action.userId}>`,
        );

        line += `, ${otherUsers.join(", ")}`;
      }
    } else if (reactions.length > 0) {
      // No starter found, just list users
      const users = reactions.map(
        (action) => action.userName || `<@${action.userId}>`,
      );

      line += users.join(", ");
    }
  } else {
    // Handle removes
    const starterRemovals = reactions.filter((action) => action.isInitial);
    const otherRemovals = reactions.filter((action) => !action.isInitial);

    if (starterRemovals.length > 0) {
      const starterUsers = starterRemovals.map((action) => {
        const username = action.userName || `<@${action.userId}>`;
        return `${username} (starter)`;
      });

      line += starterUsers.join(", ");

      if (otherRemovals.length > 0) {
        const otherUsers = otherRemovals.map(
          (action) => action.userName || `<@${action.userId}>`,
        );

        line += `, ${otherUsers.join(", ")}`;
      }
    } else if (otherRemovals.length > 0) {
      const users = otherRemovals.map(
        (action) => action.userName || `<@${action.userId}>`,
      );

      line += users.join(", ");
    }
  }

  return line;
}

function hasQuickTogglePattern(actions: ReactionEvent[]): boolean {
  // Group by user and emoji to detect rapid toggles
  const userEmojiActions = new Map<string, ReactionEvent[]>();

  for (const action of actions) {
    const key = `${action.userId}-${action.emoji}`;
    if (!userEmojiActions.has(key)) {
      userEmojiActions.set(key, []);
    }
    const actions = userEmojiActions.get(key);
    if (actions) {
      actions.push(action);
    }
  }

  // Check for rapid add/remove patterns
  for (const [_, userActions] of userEmojiActions) {
    if (userActions.length >= 3) {
      // Sort by timestamp
      userActions.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      // Check if there are rapid toggles (add->remove->add or remove->add->remove)
      for (let i = 0; i < userActions.length - 2; i++) {
        const timeDiff =
          userActions[i + 2].timestamp.getTime() -
          userActions[i].timestamp.getTime();
        if (timeDiff < 10000) {
          // Within 10 seconds
          return true;
        }
      }
    }
  }

  return false;
}
