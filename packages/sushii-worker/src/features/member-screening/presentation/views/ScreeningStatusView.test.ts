import { describe, expect, test } from "bun:test";
import type { TextDisplayComponentData } from "discord.js";
import { ComponentType } from "discord.js";

import type {
  ScreeningGuildSettings,
  ScreeningGuildStats,
} from "../../domain/types";
import { buildScreeningStatus } from "./ScreeningStatusView";

function texts(container: ReturnType<typeof buildScreeningStatus>): string[] {
  return container
    .toJSON()
    .components.filter((c) => c.type === ComponentType.TextDisplay)
    .map((c) => (c as TextDisplayComponentData).content);
}

function settings(
  overrides: Partial<ScreeningGuildSettings>,
): ScreeningGuildSettings {
  return {
    guildId: "100000000000000001",
    logChannelId: "200000000000000001",
    maxMessages: 20,
    windowHours: 72,
    reviewThreshold: 0.7,
    rules: null,
    checkAvatars: true,
    dailyCheckCap: 2000,
    enabledBy: "300000000000000001",
    enabledAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("buildScreeningStatus", () => {
  test("renders the empty state", () => {
    const content = texts(buildScreeningStatus([], [], new Map()));

    expect(content).toEqual([
      "## Member screening\nNo servers are allowlisted yet.\n-# Add one with `/member-screening enable`.",
    ]);
  });

  test("renders each guild with stats, totals and footer", () => {
    const stats: ScreeningGuildStats[] = [
      {
        guildId: "100000000000000001",
        checks: 1312,
        flagged: 14,
        actioned: 9,
        ignored: 1,
        awaiting: 4,
        missed: 2,
        cost: 0.11,
      },
      {
        guildId: "100000000000000002",
        checks: 5,
        flagged: 0,
        actioned: 0,
        ignored: 0,
        awaiting: 0,
        missed: 0,
        cost: 0.02,
      },
    ];

    const content = texts(
      buildScreeningStatus(
        [
          settings({}),
          settings({
            guildId: "100000000000000002",
            logChannelId: null,
            rules: ["scam", "sale"],
          }),
        ],
        stats,
        new Map([["100000000000000001", "Lisa Fans"]]),
      ),
    );

    expect(content).toEqual([
      "## Member screening\n-# 2 servers allowlisted · last 7 days · $0.13 total",
      [
        "### Lisa Fans",
        "-# `100000000000000001` · logs to <#200000000000000001>",
        "**1,312** checks · **14** flagged · **$0.11** spent",
        "🔨 9 actioned · 🚫 1 ignored · ⏳ 4 awaiting review · 🔍 2 missed",
        "-# First 20 messages or 72h · threshold 0.70 · default rules",
      ].join("\n"),
      [
        "### 100000000000000002",
        "-# `100000000000000002` · no log channel",
        "**5** checks · **0** flagged · **$0.02** spent",
        "🔨 0 actioned · 🚫 0 ignored · ⏳ 0 awaiting review · 🔍 0 missed",
        "-# First 20 messages or 72h · threshold 0.70 · rules: scam, sale",
      ].join("\n"),
      "-# Missed = new members banned, kicked or timed out without a flag.",
    ]);
  });

  test("uses zero stats for a guild with no verdicts", () => {
    const content = texts(buildScreeningStatus([settings({})], [], new Map()));

    expect(content[0]).toContain("1 server allowlisted");
    expect(content[1]).toContain("**0** checks");
  });
});
