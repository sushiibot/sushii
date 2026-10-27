import type { ButtonBuilder as ButtonBuilderType } from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from "discord.js";

import type { EmojiMap } from "@/features/bot-emojis/domain/types";
import type { CommandMentions } from "@/shared/presentation/commandMentions";
import Color from "@/utils/colors";

import type { HelpAudience } from "../../domain/helpCatalog";
import type { HELP_EMOJI_NAMES } from "../../domain/helpCatalog";
import type { HelpCommandEntry } from "../../domain/helpCatalog";
import { HELP_NEW_ORDER } from "../../domain/helpCatalog";
import { helpTabId } from "../helpIds";
import type { VisibleCategory, VisibleHelp } from "../helpVisibility";
import { isNew } from "../helpVisibility";

export type HelpEmojis = EmojiMap<typeof HELP_EMOJI_NAMES>;

export interface HelpViewInput {
  audience: HelpAudience;
  visible: VisibleHelp;
  emojis: HelpEmojis;
  mentions: CommandMentions;
  guildId?: string;
  /** User whose tabs these are; anyone else clicking gets their own private copy. */
  ownerId: string;
  now: Date;
}

export const TAB_LABELS: Record<HelpAudience, string> = {
  members: "Members",
  moderators: "Moderators",
  admins: "Admins",
};

const DOCS_URL = "https://sushii.bot";

export function helpTextDisplay(content: string): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(content);
}

function divider(): SeparatorBuilder {
  return new SeparatorBuilder()
    .setDivider(true)
    .setSpacing(SeparatorSpacingSize.Small);
}

/** An unsynced app emoji is "", so the icon and its trailing space drop out. */
export function prefixed(emoji: string, rest: string): string {
  return emoji ? `${emoji} ${rest}` : rest;
}

export function emojiFor(emojis: HelpEmojis, name: string): string {
  return (emojis as Readonly<Record<string, string>>)[name] ?? "";
}

export function addHelpFooter(
  container: ContainerBuilder,
  mentions: CommandMentions,
  guildId: string | undefined,
): void {
  container.addSeparatorComponents(divider());
  container.addTextDisplayComponents(
    helpTextDisplay(
      `-# Search any command: ${mentions.mention("help", guildId)} \`command:\` · Full docs: <${DOCS_URL}>`,
    ),
  );
}

function tabRow(
  active: HelpAudience,
  audiences: readonly HelpAudience[],
  ownerId: string,
): ActionRowBuilder<ButtonBuilderType> {
  const row = new ActionRowBuilder<ButtonBuilderType>();
  for (const audience of audiences) {
    const isActive = audience === active;
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(helpTabId(audience, ownerId))
        .setLabel(TAB_LABELS[audience])
        .setStyle(isActive ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(isActive),
    );
  }
  return row;
}

function newLine(input: HelpViewInput): string | null {
  const rank = (name: string) => {
    const i = HELP_NEW_ORDER.indexOf(name);
    return i === -1 ? HELP_NEW_ORDER.length : i;
  };
  const commands = input.visible.categories
    .flatMap((v) => v.commands.filter((c) => isNew(c, input.now)))
    .sort((a, b) => rank(a.name) - rank(b.name));
  if (commands.length === 0) {
    return null;
  }

  const list = commands.map((c) => commandMention(input, c)).join(" · ");
  return prefixed(input.emojis.sparkle, `**New:** ${list}`);
}

function commandMention(input: HelpViewInput, command: HelpCommandEntry) {
  return input.mentions.mention(command.link ?? command.name, input.guildId);
}

function categoryBlock(input: HelpViewInput, visible: VisibleCategory): string {
  const { category } = visible;
  const lines = visible.commands.map((command) => {
    const mention = commandMention(input, command);
    const sparkle =
      isNew(command, input.now) && input.emojis.sparkle
        ? ` ${input.emojis.sparkle}`
        : "";
    return `${mention}${sparkle} · ${command.summary}`;
  });

  let block =
    `### ${prefixed(emojiFor(input.emojis, category.emoji), category.name)}\n` +
    lines.join("\n");
  if (visible.apps.length > 0) {
    block +=
      "\n-# Right-click → Apps: " +
      visible.apps.map((app) => `**${app}**`).join(", ");
  }
  return block;
}

export function buildHelpPage(input: HelpViewInput): {
  components: ContainerBuilder[];
  flags: MessageFlags.IsComponentsV2;
  allowedMentions: { parse: [] };
} {
  const container = new ContainerBuilder().setAccentColor(Color.Info);

  if (input.visible.audiences.length >= 2) {
    container.addActionRowComponents(
      tabRow(input.audience, input.visible.audiences, input.ownerId),
    );
    container.addSeparatorComponents(divider());
  }

  if (input.audience === "members") {
    container.addTextDisplayComponents(
      helpTextDisplay("## What sushii can do"),
    );
    const line = newLine(input);
    if (line) {
      container.addTextDisplayComponents(helpTextDisplay(line));
    }
  }

  for (const visible of input.visible.categories) {
    if (visible.category.audience === input.audience) {
      container.addTextDisplayComponents(
        helpTextDisplay(categoryBlock(input, visible)),
      );
    }
  }

  addHelpFooter(container, input.mentions, input.guildId);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}
