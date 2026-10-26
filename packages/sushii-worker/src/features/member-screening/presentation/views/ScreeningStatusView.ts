import {
  ContainerBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
} from "discord.js";

import type {
  ScreeningGuildSettings,
  ScreeningGuildStats,
} from "../../domain/types";

const integer = new Intl.NumberFormat("en-US");
// Each guild section is up to ~400 chars; more would pass Discord's 4000-char text limit.
const MAX_LISTED_GUILDS = 8;

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

function emptyStats(guildId: string): ScreeningGuildStats {
  return {
    guildId,
    checks: 0,
    flagged: 0,
    actioned: 0,
    ignored: 0,
    awaiting: 0,
    missed: 0,
    cost: 0,
  };
}

export interface ScreeningStatusGuild {
  settings: ScreeningGuildSettings;
  active: boolean;
}

function guildSection(
  { settings, active }: ScreeningStatusGuild,
  stats: ScreeningGuildStats,
  name: string | undefined,
): string {
  let state: string;
  if (active) {
    state = `✅ active · logs to <#${settings.logChannelId}>`;
  } else if (!settings.enabled) {
    state = "⏸️ inactive · mods haven't turned it on";
  } else {
    state = "⏸️ inactive · no log channel";
  }
  const rules = settings.rules
    ? `rules: ${settings.rules.join(", ")}`
    : "default rules";

  return [
    `### ${name ?? settings.guildId}`,
    `-# \`${settings.guildId}\` · ${state}`,
    `**${integer.format(stats.checks)}** checks · **${integer.format(stats.flagged)}** flagged · **${formatCost(stats.cost)}** spent`,
    `🔨 ${integer.format(stats.actioned)} actioned · 🚫 ${integer.format(stats.ignored)} ignored · ⏳ ${integer.format(stats.awaiting)} awaiting review · 🔍 ${integer.format(stats.missed)} missed`,
    `-# First ${settings.maxMessages} messages or ${settings.windowHours}h · threshold ${settings.reviewThreshold.toFixed(2)} · ${rules}`,
  ].join("\n");
}

export function buildScreeningStatus(
  guilds: ScreeningStatusGuild[],
  stats: ScreeningGuildStats[],
  guildNames: Map<string, string>,
): ContainerBuilder {
  const container = new ContainerBuilder();

  if (guilds.length === 0) {
    return container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## Member screening\nNo servers have the `member_screening` flag yet.\n-# Turn it on with `/feature-flag enable`.",
      ),
    );
  }

  const statsByGuild = new Map(stats.map((s) => [s.guildId, s]));
  const totalCost = guilds.reduce(
    (sum, g) => sum + (statsByGuild.get(g.settings.guildId)?.cost ?? 0),
    0,
  );
  const activeCount = guilds.filter((g) => g.active).length;
  const serverLabel = guilds.length === 1 ? "server" : "servers";

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## Member screening\n-# ${guilds.length} ${serverLabel} flagged · ${activeCount} active · last 7 days · ${formatCost(totalCost)} total`,
    ),
  );

  const shown = guilds.slice(0, MAX_LISTED_GUILDS);
  for (const guild of shown) {
    const { guildId } = guild.settings;
    container
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          guildSection(
            guild,
            statsByGuild.get(guildId) ?? emptyStats(guildId),
            guildNames.get(guildId),
          ),
        ),
      );
  }

  const hidden = guilds.length - shown.length;
  if (hidden > 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# …and ${hidden} more`),
    );
  }

  return container
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "-# Missed = new members banned, kicked or timed out without a flag.",
      ),
    );
}
