import type { InteractionReplyOptions } from "discord.js";
import {
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} from "discord.js";

import Color from "@/utils/colors";

export interface ReactionStarterData {
  emoji: string;
  starterId: string;
  starterRemoved: boolean;
}

export interface ReactionStartersViewData {
  currentWithStarters: ReactionStarterData[];
  currentWithoutStarters: string[];
  completelyRemoved: { emoji: string; starterId: string }[];
  allStarters: Map<string, string>;
}

export function createReactionStartersMessage(
  data: ReactionStartersViewData,
): InteractionReplyOptions & { flags: MessageFlags.IsComponentsV2 } {
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
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    };
  }

  // Main header
  const headerSection = new TextDisplayBuilder().setContent(
    "## Reaction Starters",
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
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

function buildCurrentReactionsSection(
  currentWithStarters: ReactionStarterData[],
): TextDisplayBuilder {
  let content = "### Current Reactions\n";

  for (const { emoji, starterId, starterRemoved } of currentWithStarters) {
    const removedText = starterRemoved ? " (starter removed)" : "";
    content += `• ${emoji} - started by <@${starterId}>${removedText}\n`;
  }

  return new TextDisplayBuilder().setContent(content);
}

function buildUnknownStartersSection(
  currentWithoutStarters: string[],
): TextDisplayBuilder {
  let content = "### Current (Unknown Starter)\n";

  for (const emoji of currentWithoutStarters) {
    content += `- ${emoji} - starter unknown\n`;
  }

  return new TextDisplayBuilder().setContent(content);
}

function buildRemovedReactionsSection(
  completelyRemoved: { emoji: string; starterId: string }[],
): TextDisplayBuilder {
  let content = "### Removed\n";

  for (const { emoji, starterId } of completelyRemoved) {
    content += `- ${emoji} - started by <@${starterId}>\n`;
  }

  return new TextDisplayBuilder().setContent(content);
}

function buildAllStartersSection(
  allStarters: Map<string, string>,
): TextDisplayBuilder {
  let content = "### All Known Starters\n";

  for (const [emoji, starterId] of allStarters) {
    content += `- ${emoji} - started by <@${starterId}>\n`;
  }

  return new TextDisplayBuilder().setContent(content);
}
