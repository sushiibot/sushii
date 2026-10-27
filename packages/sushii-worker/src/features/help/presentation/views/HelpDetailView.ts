import type { PermissionsBitField } from "discord.js";
import { ContainerBuilder, MessageFlags } from "discord.js";

import type { CommandMentions } from "@/shared/presentation/commandMentions";
import Color from "@/utils/colors";

import type { HelpAppEntry, HelpIndexEntry } from "../../application/helpIndex";
import {
  findExactEntry,
  normalizeQuery,
  rankHelpEntries,
} from "../../application/helpIndex";
import { canRun } from "../helpVisibility";
import { permissionNames } from "../permissionNames";
import { truncateCodePoints } from "../truncate";
import type { HelpEmojis } from "./HelpView";
import {
  TAB_LABELS,
  addHelpFooter,
  emojiFor,
  helpTextDisplay,
  prefixed,
} from "./HelpView";

export interface HelpDetailInput {
  query: string;
  entries: readonly HelpIndexEntry[];
  memberPermissions: Readonly<PermissionsBitField> | null;
  emojis: HelpEmojis;
  mentions: CommandMentions;
  guildId?: string;
}

const SUGGESTION_COUNT = 5;
const MAX_QUERY_DISPLAY = 50;
// Leaves room for the title, tab line and footer under the 4000 character limit.
const MAX_LIST_CHARACTERS = 3000;

function hasSubcommands(input: HelpDetailInput, entry: HelpIndexEntry) {
  return (
    entry.path === entry.root &&
    input.entries.some((e) => e.root === entry.root && e.path !== e.root)
  );
}

/** Discord won't render a mention of a command that has subcommands, so those stay bold text. */
function label(input: HelpDetailInput, entry: HelpIndexEntry): string {
  if (entry.kind === "app") {
    return `**${entry.path}** (right-click app)`;
  }
  if (hasSubcommands(input, entry)) {
    return `**/${entry.path}**`;
  }
  return input.mentions.mention(entry.path, input.guildId);
}

function listLine(input: HelpDetailInput, entry: HelpIndexEntry): string {
  return entry.kind === "app"
    ? label(input, entry)
    : `${label(input, entry)} · ${entry.description}`;
}

function boundedList(lines: string[]): string {
  const kept: string[] = [];
  let length = 0;
  for (const line of lines) {
    if (length + line.length + 1 > MAX_LIST_CHARACTERS) {
      kept.push(`…and ${lines.length - kept.length} more`);
      break;
    }
    kept.push(line);
    length += line.length + 1;
  }
  return kept.join("\n");
}

function needsText(entry: HelpIndexEntry): string | null {
  const required = entry.defaultMemberPermissions;
  if (required === null || required === undefined) {
    return null;
  }
  return permissionNames(required).join(", ");
}

function tabLine(entry: HelpIndexEntry): string | null {
  const needs = needsText(entry);
  const parts = [
    needs ? `Needs **${needs}**` : null,
    entry.audience ? `${TAB_LABELS[entry.audience]} tab` : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? `-# ${parts.join(" · ")}` : null;
}

/** Inline code keeps markdown and mentions in the query inert; backticks would end it early. */
function displayQuery(query: string): string | null {
  const cleaned = query.replace(/`/g, "").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return null;
  }
  return `\`${truncateCodePoints(cleaned, MAX_QUERY_DISPLAY)}\``;
}

function commandCard(input: HelpDetailInput, entry: HelpIndexEntry): string[] {
  const subcommands = input.entries.filter(
    (e) => e.root === entry.root && e.path !== e.root,
  );
  const emoji = entry.rootCategory
    ? emojiFor(input.emojis, entry.rootCategory.emoji)
    : "";
  const blocks = [
    `## ${prefixed(emoji, label(input, entry))}\n${entry.description}`,
  ];

  if (entry.path === entry.root) {
    if (subcommands.length > 0) {
      const lines = subcommands.map((e) => listLine(input, e));
      blocks.push(`**Subcommands**\n${boundedList(lines)}`);
    }
  } else {
    const others = subcommands.filter((e) => e.path !== entry.path);
    if (others.length > 0) {
      const lines = others.map((e) => listLine(input, e));
      blocks.push(`**Also in /${entry.root}**\n${boundedList(lines)}`);
    }
  }

  return blocks;
}

function appCard(entry: HelpAppEntry): string[] {
  return [
    `## ${entry.path}\nRight-click a ${entry.appTarget} → Apps → **${entry.path}**`,
  ];
}

function noPermission(input: HelpDetailInput, entry: HelpIndexEntry): string {
  const needs = needsText(entry);
  return needs
    ? `You don't have permission to use ${label(input, entry)}. It needs **${needs}**.`
    : `You don't have permission to use ${label(input, entry)}.`;
}

function notFound(input: HelpDetailInput): string[] {
  const shown = displayQuery(input.query);
  const heading = shown
    ? `No command called ${shown}.`
    : "No command matched your search.";

  const suggestions = rankHelpEntries(
    input.entries.filter((e) =>
      canRun(e.defaultMemberPermissions, input.memberPermissions),
    ),
    input.query,
  ).slice(0, SUGGESTION_COUNT);

  if (suggestions.length === 0 || !normalizeQuery(input.query)) {
    return [
      `${heading}\nNothing matched. Try ${input.mentions.mention("help", input.guildId)} without a search.`,
    ];
  }

  return [
    heading,
    `**Did you mean**\n${suggestions.map((e) => listLine(input, e)).join("\n")}`,
  ];
}

/** A found command card is worth posting publicly; misses and denials aren't. */
export function isShareableDetail(input: HelpDetailInput): boolean {
  const exact = findExactEntry(input.entries, input.query);
  return (
    exact !== null &&
    canRun(exact.defaultMemberPermissions, input.memberPermissions)
  );
}

export function buildHelpDetail(input: HelpDetailInput): {
  components: ContainerBuilder[];
  flags: MessageFlags.IsComponentsV2;
  allowedMentions: { parse: [] };
} {
  const container = new ContainerBuilder().setAccentColor(Color.Info);
  const exact = findExactEntry(input.entries, input.query);

  let blocks: string[];
  if (!exact) {
    blocks = notFound(input);
  } else if (!canRun(exact.defaultMemberPermissions, input.memberPermissions)) {
    blocks = [noPermission(input, exact)];
  } else {
    blocks = exact.kind === "app" ? appCard(exact) : commandCard(input, exact);
    const line = tabLine(exact);
    if (line) {
      blocks.push(line);
    }
  }

  for (const block of blocks) {
    container.addTextDisplayComponents(helpTextDisplay(block));
  }
  addHelpFooter(container, input.mentions, input.guildId);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}
