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
    enabled: true,
    ...overrides,
  };
}

describe("buildScreeningStatus", () => {
  test("renders the empty state", () => {
    const content = texts(buildScreeningStatus([], [], new Map()));

    expect(content).toEqual([
      "## Member screening\nNo servers have the `member_screening` flag yet.\n-# Turn it on with `/feature-flag enable`.",
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
          { settings: settings({}), active: true },
          {
            settings: settings({
              guildId: "100000000000000002",
              logChannelId: null,
              rules: ["scam", "sale"],
            }),
            active: false,
          },
        ],
        stats,
        new Map([["100000000000000001", "Lisa Fans"]]),
      ),
    );

    expect(content).toEqual([
      "## Member screening\n-# 2 servers flagged · 1 active · last 7 days · $0.13 total",
      [
        "### Lisa Fans",
        "-# `100000000000000001` · ✅ active · logs to <#200000000000000001>",
        "**1,312** checks · **14** flagged · **$0.11** spent",
        "🔨 9 actioned · 🚫 1 ignored · ⏳ 4 awaiting review · 🔍 2 missed",
        "-# First 20 messages or 72h · threshold 0.70 · default rules",
      ].join("\n"),
      [
        "### 100000000000000002",
        "-# `100000000000000002` · ⏸️ inactive · no log channel",
        "**5** checks · **0** flagged · **$0.02** spent",
        "🔨 0 actioned · 🚫 0 ignored · ⏳ 0 awaiting review · 🔍 0 missed",
        "-# First 20 messages or 72h · threshold 0.70 · rules: scam, sale",
      ].join("\n"),
      "-# Missed = new members banned, kicked or timed out without a flag.",
    ]);
  });

  test("uses zero stats for a guild with no verdicts", () => {
    const content = texts(
      buildScreeningStatus(
        [{ settings: settings({}), active: true }],
        [],
        new Map(),
      ),
    );

    expect(content[0]).toContain("1 server flagged");
    expect(content[1]).toContain("**0** checks");
  });

  test("says when mods haven't turned screening on", () => {
    const content = texts(
      buildScreeningStatus(
        [{ settings: settings({ enabled: false }), active: false }],
        [],
        new Map(),
      ),
    );

    expect(content[1]).toContain(
      "-# `100000000000000001` · ⏸️ inactive · mods haven't turned it on",
    );
  });

  test("caps at 8 guilds and stays under 4000 characters", () => {
    const guilds = Array.from({ length: 12 }, (_, n) => ({
      settings: settings({
        guildId: `1000000000000000${String(n).padStart(2, "0")}`,
        rules: ["scam", "sale", "promo", "sexual", "hate", "harassment"],
      }),
      active: true,
    }));
    const names = new Map(
      guilds.map((g) => [g.settings.guildId, "N".repeat(100)]),
    );
    const stats = guilds.map((g) => ({
      guildId: g.settings.guildId,
      checks: 1_234_567,
      flagged: 12_345,
      actioned: 12_345,
      ignored: 12_345,
      awaiting: 12_345,
      missed: 12_345,
      cost: 1234.56,
    }));

    const content = texts(buildScreeningStatus(guilds, stats, names));

    expect(content.join("").length).toBeLessThan(4000);
    expect(content).toContain("-# …and 4 more");
    expect(content[0]).toContain("12 servers flagged");
    expect(content.filter((c) => c.startsWith("### "))).toHaveLength(8);
  });
});
