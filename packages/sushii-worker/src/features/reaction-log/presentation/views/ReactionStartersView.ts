import type { InteractionReplyOptions } from "discord.js";
import {
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} from "discord.js";

import Color from "@/utils/colors";

import type { ReactionStarter } from "../../domain/entities/ReactionStarter";
import { formatEmojiWithUrl } from "../../shared/utils/EmojiFormatter";

export interface ReactionStarterData {
  emoji: string;
  starterIds: string[];
  emojiId?: string;
  emojiName?: string;
}

export interface UnknownStarterData {
  emoji: string;
  emojiId?: string;
  emojiName?: string;
}

export interface ReactionStartersViewData {
  currentWithStarters: ReactionStarterData[];
  currentWithoutStarters: UnknownStarterData[];
  completelyRemoved: ReactionStarter[];
  allStarters: Map<string, ReactionStarter>;
}

export function createReactionStartersMessage(
  data: ReactionStartersViewData,
): InteractionReplyOptions & {
  flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
} {
  const container = new ContainerBuilder().setAccentColor(Color.Info);

  const {
    currentWithStarters,
    currentWithoutStarters,
    completelyRemoved,
    allStarters,
  } = data;

  // Handle case where there's no reaction history
  if (allStarters.size === 0 && currentWithStarters.length === 0) {
    const noHistorySection = new TextDisplayBuilder().setContent(
      "This message has no reaction history.",
    );
    container.addTextDisplayComponents(noHistorySection);

    return {
      components: [container],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    };
  }

  // Main header
  const headerSection = new TextDisplayBuilder().setContent(
    "### Reaction Starters" +
      "\nUsers that added the *first* reaction to this message for each emoji, " +
      "excluding anyone who clicked on an existing reaction.",
  );
  container.addTextDisplayComponents(headerSection);

  let hasContent = false;

  // Current reactions with known starters
  if (currentWithStarters.length > 0) {
    if (hasContent) {
      container.addSeparatorComponents(new SeparatorBuilder());
    }

    const currentSection = buildCurrentReactionsSection(currentWithStarters);
    container.addTextDisplayComponents(currentSection);
    hasContent = true;
  }

  // Current reactions without known starters
  if (currentWithoutStarters.length > 0) {
    if (hasContent) {
      container.addSeparatorComponents(new SeparatorBuilder());
    }

    const unknownSection = buildUnknownStartersSection(currentWithoutStarters);
    container.addTextDisplayComponents(unknownSection);
    hasContent = true;
  }

  // Completely removed reactions
  if (completelyRemoved.length > 0) {
    if (hasContent) {
      container.addSeparatorComponents(new SeparatorBuilder());
    }

    const removedSection = buildRemovedReactionsSection(completelyRemoved);
    container.addTextDisplayComponents(removedSection);
    hasContent = true;
  }

  // Fallback if we have starters but no categorization worked
  if (!hasContent && allStarters.size > 0) {
    const fallbackSection = buildAllStartersSection(allStarters);
    container.addTextDisplayComponents(fallbackSection);
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  };
}

function buildCurrentReactionsSection(
  currentWithStarters: ReactionStarterData[],
): TextDisplayBuilder {
  let content = "### Current Reactions\n";

  for (const { emoji, starterIds, emojiId, emojiName } of currentWithStarters) {
    const formattedEmoji = formatEmojiWithUrl({
      emojiString: emoji,
      emojiId,
      emojiName,
    });

    const starterText = formatMultipleStarters(starterIds);
    content += `- ${formattedEmoji} - ${starterText}\n`;
  }

  return new TextDisplayBuilder().setContent(content);
}

function buildUnknownStartersSection(
  currentWithoutStarters: UnknownStarterData[],
): TextDisplayBuilder {
  let content = "### Current Reactions (Unknown Starter)\n";

  for (const { emoji, emojiId, emojiName } of currentWithoutStarters) {
    const formattedEmoji = formatEmojiWithUrl({
      emojiString: emoji,
      emojiId,
      emojiName,
    });
    content += `- ${formattedEmoji} - starter unknown\n`;
  }

  return new TextDisplayBuilder().setContent(content);
}

function buildRemovedReactionsSection(
  completelyRemoved: ReactionStarter[],
): TextDisplayBuilder {
  let content = "### Removed\n";

  for (const starter of completelyRemoved) {
    // Use the starter entity to format with full emoji data
    const formattedEmoji = formatEmojiWithUrl({
      emojiString: starter.getDisplayString(),
      emojiId: starter.isCustomEmoji() ? starter.emojiId : undefined,
      emojiName: starter.emojiName || undefined,
    });
    const starterText = formatMultipleStarters(starter.userIds);
    content += `- ${formattedEmoji} - ${starterText}\n`;
  }

  return new TextDisplayBuilder().setContent(content);
}

function buildAllStartersSection(
  allStarters: Map<string, ReactionStarter>,
): TextDisplayBuilder {
  let content = "### All Known Starters\n";

  for (const [_emojiId, starter] of allStarters) {
    // Use the starter's display string and format with URL
    const formattedEmoji = formatEmojiWithUrl({
      emojiString: starter.getDisplayString(),
      emojiId: starter.isCustomEmoji() ? starter.emojiId : undefined,
      emojiName: starter.emojiName || undefined,
    });
    const starterText = formatMultipleStarters(starter.userIds);
    content += `- ${formattedEmoji} - ${starterText}\n`;
  }

  return new TextDisplayBuilder().setContent(content);
}

function formatMultipleStarters(starterIds: string[]): string {
  if (starterIds.length === 0) {
    return "starter unknown";
  }

  if (starterIds.length === 1) {
    return `started by <@${starterIds[0]}>`;
  }

  // Multiple starters - show with re-started format
  const firstStarter = starterIds[0];
  const reStarters = starterIds.slice(1);
  const restarterMentions = reStarters.map((id) => `<@${id}>`).join(", ");
  return `started by <@${firstStarter}>; re-started by ${restarterMentions}`;
}
