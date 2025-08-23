import { EmbedBuilder } from "discord.js";

import Color from "@/utils/colors";

import type {
  ReactionBatch,
  ReactionEvent,
} from "../../domain/types/ReactionEvent";

export function createReactionLogMessage(batch: ReactionBatch): {
  embeds: EmbedBuilder[];
} {
  const embed = createReactionLogEmbed(batch);
  return { embeds: [embed] };
}

function createReactionLogEmbed(batch: ReactionBatch): EmbedBuilder {
  const emojiGroups = groupByEmoji(batch.actions);

  let description = `📊 Reaction Activity\n`;
  description += `https://discord.com/channels/${batch.guildId}/${batch.channelId}/${batch.messageId}\n\n`;

  // Format adds
  const adds = formatAdds(emojiGroups);
  if (adds) {
    description += `✅ Added:\n${adds}\n\n`;
  }

  // Format removes
  const removes = formatRemoves(emojiGroups);
  if (removes) {
    description += `❌ Removed:\n${removes}\n\n`;
  }

  // Time window
  const endTime = new Date();
  const startTime = batch.startTime.toLocaleTimeString();
  const endTimeStr = endTime.toLocaleTimeString();

  if (startTime !== endTimeStr) {
    description += `Time: ${startTime} - ${endTimeStr}`;
  } else {
    description += `Time: ${startTime}`;
  }

  // Determine embed color based on activity
  let color = Color.Info; // Default blue
  const hasRemovals = emojiGroups.some((group) => group.removes.length > 0);
  const hasQuickToggles = hasQuickTogglePattern(batch.actions);

  if (hasQuickToggles) {
    color = Color.Warning; // Yellow for potential spam
  } else if (hasRemovals) {
    color = Color.Error; // Red/pink for removals
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

    const group = groups.get(action.emoji)!;
    if (action.type === "add") {
      group.adds.push(action);
    } else {
      group.removes.push(action);
    }
  }

  return Array.from(groups.values());
}

function formatAdds(groups: EmojiGroup[]): string {
  const lines: string[] = [];

  for (const group of groups) {
    if (group.adds.length === 0) continue;

    const starter = group.adds.find((action) => action.isInitial);
    const others = group.adds.filter((action) => !action.isInitial);

    let line = `  ${group.emoji} - `;

    if (starter) {
      const username = starter.userName || `<@${starter.userId}>`;
      line += `${username} (started)`;

      if (others.length > 0) {
        const otherUsers = others
          .map((action) => action.userName || `<@${action.userId}>`)
          .slice(0, 5); // Limit to first 5 to prevent too long messages

        line += `, ${otherUsers.join(", ")}`;

        if (others.length > 5) {
          line += ` (+${others.length - 5} more)`;
        }
      }
    } else if (group.adds.length > 0) {
      // No starter found, just list users
      const users = group.adds
        .map((action) => action.userName || `<@${action.userId}>`)
        .slice(0, 5);

      line += users.join(", ");

      if (group.adds.length > 5) {
        line += ` (+${group.adds.length - 5} more)`;
      }
    }

    lines.push(line);
  }

  return lines.join("\\n");
}

function formatRemoves(groups: EmojiGroup[]): string {
  const lines: string[] = [];

  for (const group of groups) {
    if (group.removes.length === 0) continue;

    const starterRemovals = group.removes.filter((action) => action.isInitial);
    const otherRemovals = group.removes.filter((action) => !action.isInitial);

    let line = `  ${group.emoji} - `;

    if (starterRemovals.length > 0) {
      const starterUsers = starterRemovals.map((action) => {
        const username = action.userName || `<@${action.userId}>`;
        return `${username} (starter)`;
      });

      line += starterUsers.join(", ");

      if (otherRemovals.length > 0) {
        const otherUsers = otherRemovals
          .map((action) => action.userName || `<@${action.userId}>`)
          .slice(0, 5);

        line += `, ${otherUsers.join(", ")}`;

        if (otherRemovals.length > 5) {
          line += ` (+${otherRemovals.length - 5} more)`;
        }
      }
    } else if (otherRemovals.length > 0) {
      const users = otherRemovals
        .map((action) => action.userName || `<@${action.userId}>`)
        .slice(0, 5);

      line += users.join(", ");

      if (otherRemovals.length > 5) {
        line += ` (+${otherRemovals.length - 5} more)`;
      }
    }

    lines.push(line);
  }

  return lines.join("\\n");
}

function hasQuickTogglePattern(actions: ReactionEvent[]): boolean {
  // Group by user and emoji to detect rapid toggles
  const userEmojiActions = new Map<string, ReactionEvent[]>();

  for (const action of actions) {
    const key = `${action.userId}-${action.emoji}`;
    if (!userEmojiActions.has(key)) {
      userEmojiActions.set(key, []);
    }
    userEmojiActions.get(key)!.push(action);
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
