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

function guildSection(
  settings: ScreeningGuildSettings,
  stats: ScreeningGuildStats,
  name: string | undefined,
): string {
  const logs = settings.logChannelId
    ? `logs to <#${settings.logChannelId}>`
    : "no log channel";
  const rules = settings.rules
    ? `rules: ${settings.rules.join(", ")}`
    : "default rules";

  return [
    `### ${name ?? settings.guildId}`,
    `-# \`${settings.guildId}\` · ${logs}`,
    `**${integer.format(stats.checks)}** checks · **${integer.format(stats.flagged)}** flagged · **${formatCost(stats.cost)}** spent`,
    `🔨 ${integer.format(stats.actioned)} actioned · 🚫 ${integer.format(stats.ignored)} ignored · ⏳ ${integer.format(stats.awaiting)} awaiting review · 🔍 ${integer.format(stats.missed)} missed`,
    `-# First ${settings.maxMessages} messages or ${settings.windowHours}h · threshold ${settings.reviewThreshold.toFixed(2)} · ${rules}`,
  ].join("\n");
}

export function buildScreeningStatus(
  settings: ScreeningGuildSettings[],
  stats: ScreeningGuildStats[],
  guildNames: Map<string, string>,
): ContainerBuilder {
  const container = new ContainerBuilder();

  if (settings.length === 0) {
    return container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## Member screening\nNo servers are allowlisted yet.\n-# Add one with `/member-screening enable`.",
      ),
    );
  }

  const statsByGuild = new Map(stats.map((s) => [s.guildId, s]));
  const totalCost = settings.reduce(
    (sum, s) => sum + (statsByGuild.get(s.guildId)?.cost ?? 0),
    0,
  );
  const serverLabel = settings.length === 1 ? "server" : "servers";

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## Member screening\n-# ${settings.length} ${serverLabel} allowlisted · last 7 days · ${formatCost(totalCost)} total`,
    ),
  );

  for (const guild of settings) {
    container
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          guildSection(
            guild,
            statsByGuild.get(guild.guildId) ?? emptyStats(guild.guildId),
            guildNames.get(guild.guildId),
          ),
        ),
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
