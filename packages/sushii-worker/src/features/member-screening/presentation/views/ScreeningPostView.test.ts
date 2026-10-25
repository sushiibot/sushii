import { describe, expect, test } from "bun:test";

import type { ScreeningVerdict } from "../../domain/types";
import { buildScreeningPost, scoreBars } from "./ScreeningPostView";

const USER = "1202420700607029308";
const GUILD = "187450744427773963";
const MOD = "150443906511667200";
const JUMP = `https://discord.com/channels/${GUILD}/${GUILD}/1558174981962072126`;

const BARS_OPEN =
  "```ansi\nscam       0.02 ░░░░░░░░░░\npromo      0.04 ░░░░░░░░░░\nsexual     0.01 ░░░░░░░░░░\nhate       0.12 █░░░░░░░░░\n\u001b[1;31mharassment 0.91 █████████░ ◀\u001b[0m\nunderage   0.01 ░░░░░░░░░░\n```";

const SEPARATOR = { type: 14, divider: true, spacing: 1 };

const IGNORE_SELECT_ROW = {
  type: 1,
  components: [
    {
      type: 3,
      custom_id: "/screening/ignore/9431",
      placeholder: "Ignore…",
      options: [
        {
          label: "Too minor",
          value: "too_minor",
          description: "Real, but not worth a review",
        },
        {
          label: "Allowed here",
          value: "allowed_here",
          description: "This server permits it",
        },
        {
          label: "Not a violation",
          value: "not_violation",
          description: "The model got it wrong",
        },
        {
          label: "Wrong category",
          value: "wrong_category",
          description: "A real problem, wrong label",
        },
      ],
    },
  ],
};

const JUMP_BUTTON = {
  type: 2,
  style: 5,
  label: "Jump to message",
  url: JUMP,
};

function verdict(overrides: Partial<ScreeningVerdict> = {}): ScreeningVerdict {
  return {
    id: 9431,
    guildId: GUILD,
    channelId: GUILD,
    userId: USER,
    messageId: "1558174981962072126",
    kind: "text",
    scores: {
      scam: 0.02,
      promo: 0.04,
      sexual: 0.01,
      hate: 0.12,
      harassment: 0.91,
      underage: 0.01,
    },
    categories: null,
    topRule: "harassment",
    flagged: true,
    avatarHash: null,
    imageKey: null,
    sourceUrl: null,
    joinedAt: new Date(1792922400 * 1000),
    ordinal: 3,
    model: "typesafe/jev-1.13-20260917",
    cost: 0.00002,
    judged: {
      context: [
        { author: "mochi", text: "anyone going to the LA show?" },
        { author: "hana", text: "yes!! section 112" },
      ],
      target: [
        {
          author: "newacc_2026",
          text: "lol ur all so pathetic, imagine stanning this group",
        },
      ],
    },
    error: null,
    postChannelId: null,
    postMessageId: null,
    outcome: null,
    outcomeBy: null,
    outcomeAction: null,
    ignoreReason: null,
    outcomeAt: null,
    messageDeleted: false,
    createdAt: new Date(1792929600 * 1000),
    ...overrides,
  };
}

interface Json {
  [key: string]: unknown;
  content?: string;
  custom_id?: string;
  url?: string;
  components?: Json[];
}

function kids(json: Json | undefined): Json[] {
  return json?.components ?? [];
}

function render(
  v: ScreeningVerdict,
  automod?: { count: number; rules: string[] },
): Json {
  return buildScreeningPost(v, {
    reviewThreshold: 0.7,
    automod,
  }).toJSON() as unknown as Json;
}

function lastRow(json: Json): Json {
  const row = kids(json).at(-1);
  if (!row) {
    throw new Error("no components");
  }
  return row;
}

describe("buildScreeningPost", () => {
  test("open text flag matches the approved payload", () => {
    expect(render(verdict())).toEqual({
      type: 17,
      accent_color: 0xf0b232,
      components: [
        {
          type: 10,
          content: `### ⚠️ Suspicious message · likely harassment\n<@${USER}> (\`${USER}\`)\n-# joined <t:1792922400:R> · message #3 since join · in <#${GUILD}>`,
        },
        SEPARATOR,
        {
          type: 10,
          content:
            "-# mochi: anyone going to the LA show?\n-# hana: yes!! section 112\n> **newacc\\_2026:** lol ur all so pathetic, imagine stanning this group",
        },
        SEPARATOR,
        { type: 10, content: `${BARS_OPEN}\n-# \`scr-9431\`` },
        IGNORE_SELECT_ROW,
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 2,
              label: "Timeout",
              custom_id: "/screening/action/timeout/9431",
            },
            {
              type: 2,
              style: 4,
              label: "Ban",
              custom_id: "/screening/action/ban/9431",
            },
            JUMP_BUTTON,
          ],
        },
      ],
    });
  });

  test("burst shows every target line", () => {
    const json = render(
      verdict({
        ordinal: 5,
        judged: {
          context: [
            { author: "mochi", text: "anyone going to the LA show?" },
            { author: "hana", text: "yes!! section 112" },
          ],
          target: [
            {
              author: "newacc_2026",
              text: "lol ur all so pathetic, imagine stanning this group",
            },
            {
              author: "newacc_2026",
              text: "<@168024158041538562> especially you, log off",
            },
            { author: "newacc_2026", text: "nobody here has a life" },
          ],
        },
      }),
    );
    expect(kids(json)[2]).toEqual({
      type: 10,
      content:
        "-# mochi: anyone going to the LA show?\n-# hana: yes!! section 112\n> **newacc\\_2026:** lol ur all so pathetic, imagine stanning this group\n> **newacc\\_2026:** <@168024158041538562> especially you, log off\n> **newacc\\_2026:** nobody here has a life",
    });
    expect(kids(json)[0]?.content).toContain("message #5 since join");
  });

  test("ignored with a reason: no accent, footer reason, jump only", () => {
    const json = render(
      verdict({
        outcome: "ignored",
        outcomeBy: MOD,
        ignoreReason: "allowed_here",
      }),
    );
    expect(json.accent_color).toBeUndefined();
    expect(kids(json)[4]?.content).toBe(
      `${BARS_OPEN}\n-# \`scr-9431\` · ignored by <@${MOD}> · allowed here`,
    );
    expect(kids(json)).toHaveLength(6);
    expect(lastRow(json)).toEqual({ type: 1, components: [JUMP_BUTTON] });
  });

  test("banned: red accent, unban and jump", () => {
    const json = render(
      verdict({ outcome: "actioned", outcomeBy: MOD, outcomeAction: "banned" }),
    );
    expect(json.accent_color).toBe(0xf23f43);
    expect(kids(json)[4]?.content).toEndWith(
      `-# \`scr-9431\` · 🔨 banned by <@${MOD}>`,
    );
    expect(kids(json)).toHaveLength(6);
    expect(lastRow(json)).toEqual({
      type: 1,
      components: [
        {
          type: 2,
          style: 2,
          label: "Unban",
          custom_id: "/screening/action/unban/9431",
        },
        JUMP_BUTTON,
      ],
    });
  });

  test("timed out: remove timeout, ban and jump", () => {
    const json = render(
      verdict({
        outcome: "actioned",
        outcomeBy: MOD,
        outcomeAction: "timed out",
      }),
    );
    expect(json.accent_color).toBe(0xf23f43);
    expect(kids(json)[4]?.content).toEndWith(
      `-# \`scr-9431\` · 🔨 timed out by <@${MOD}>`,
    );
    expect(lastRow(json)).toEqual({
      type: 1,
      components: [
        {
          type: 2,
          style: 2,
          label: "Remove timeout",
          custom_id: "/screening/action/untimeout/9431",
        },
        {
          type: 2,
          style: 4,
          label: "Ban",
          custom_id: "/screening/action/ban/9431",
        },
        JUMP_BUTTON,
      ],
    });
  });

  test("timeout with a duration still offers remove timeout and ban", () => {
    const json = render(
      verdict({
        outcome: "actioned",
        outcomeBy: MOD,
        outcomeAction: "timed out 1h",
      }),
    );
    expect(kids(json)[4]?.content).toEndWith(
      `-# \`scr-9431\` · 🔨 timed out 1h by <@${MOD}>`,
    );
    expect(kids(lastRow(json)).map((c) => c.custom_id ?? c.url)).toEqual([
      "/screening/action/untimeout/9431",
      "/screening/action/ban/9431",
      JUMP,
    ]);
  });

  test("other actions and unattributed outcomes: jump only, no 'by'", () => {
    const json = render(
      verdict({
        outcome: "actioned",
        outcomeBy: null,
        outcomeAction: "kicked",
      }),
    );
    expect(kids(json)[4]?.content).toEndWith("-# `scr-9431` · 🔨 kicked");
    expect(lastRow(json)).toEqual({ type: 1, components: [JUMP_BUTTON] });
  });

  test("pfp flag: spoilered thumbnail section, reason, no ansi", () => {
    const json = render(
      verdict({
        id: 9502,
        kind: "pfp",
        ordinal: 1,
        scores: null,
        topRule: null,
        categories: ["sexual"],
        sourceUrl: "https://cdn.discordapp.com/avatars/1/a.png",
        judged: {
          reason:
            "The image shows a cartoon depiction of a woman with exposed nipples.",
        },
      }),
    );
    expect(json.accent_color).toBe(0xf0b232);
    expect(kids(json).slice(0, 2)).toEqual([
      {
        type: 9,
        components: [
          {
            type: 10,
            content: `### ⚠️ Suspicious profile picture · sexual\n<@${USER}> (\`${USER}\`)\n-# joined <t:1792922400:R> · message #1 since join · in <#${GUILD}>`,
          },
        ],
        accessory: {
          type: 11,
          media: { url: "https://cdn.discordapp.com/avatars/1/a.png" },
          spoiler: true,
        },
      },
      {
        type: 10,
        content:
          "> The image shows a cartoon depiction of a woman with exposed nipples.\n-# `scr-9502`",
      },
    ]);
    expect(kids(json)).toHaveLength(4);
    expect(JSON.stringify(json)).not.toContain("```");
    const select = kids(kids(json)[2])[0];
    expect(select?.custom_id).toBe("/screening/ignore/9502");
    expect(kids(lastRow(json)).map((c) => c.custom_id ?? c.url)).toEqual([
      "/screening/action/timeout/9502",
      "/screening/action/ban/9502",
      JUMP,
    ]);
  });

  test("image flag: spoilered gallery, reason, no ansi", () => {
    const url = "https://cdn.discordapp.com/attachments/1/2/pic.jpg?ex=1";
    const json = render(
      verdict({
        kind: "image",
        scores: null,
        topRule: null,
        categories: ["Sexual", "gore"],
        sourceUrl: url,
        imageKey: "/attachments/1/2/pic.jpg",
        judged: { reason: "Nudity." },
      }),
    );
    expect(kids(json)[0]?.content).toStartWith(
      "### ⚠️ Suspicious image link · sexual, gore\n",
    );
    expect(kids(json)[1]).toEqual({
      type: 12,
      items: [{ media: { url }, spoiler: true }],
    });
    expect(kids(json)[2]).toEqual({
      type: 10,
      content: "> Nudity.\n-# `scr-9431`",
    });
    expect(JSON.stringify(json)).not.toContain("```");
  });

  test("automod blocks and deleted message show in the who line", () => {
    const json = render(verdict({ messageDeleted: true }), {
      count: 2,
      rules: ["Slurs", "Scam links"],
    });
    expect(kids(json)[0]?.content).toEndWith(
      `in <#${GUILD}> · **message deleted**\n-# 🛡️ 2 messages blocked by AutoMod (Slurs, Scam links)`,
    );
  });

  test("ignored without a mod or reason keeps a bare footer", () => {
    const json = render(
      verdict({ outcome: "ignored", outcomeBy: null, ignoreReason: null }),
    );
    expect(kids(json)[4]?.content).toEndWith("-# `scr-9431` · ignored");
    expect(lastRow(json)).toEqual({ type: 1, components: [JUMP_BUTTON] });
  });

  test("display names are markdown-escaped", () => {
    const json = render(
      verdict({
        judged: {
          context: [{ author: "__mochi__", text: "hi" }],
          target: [{ author: "**bold**", text: "free nitro" }],
        },
      }),
    );
    expect(kids(json)[2]?.content).toBe(
      "-# \\_\\_mochi\\_\\_: hi\n> **\\*\\*bold\\*\\*:** free nitro",
    );
  });

  test("masked links in display names are escaped", () => {
    const json = render(
      verdict({
        judged: {
          context: [],
          target: [{ author: "[Mod Team](https://dsc.gg/x)", text: "hi" }],
        },
      }),
    );
    expect(kids(json)[2]?.content).toBe(
      "> **\\[Mod Team](https://dsc.gg/x):** hi",
    );
  });

  test("long lines are truncated without splitting surrogate pairs", () => {
    const json = render(
      verdict({
        judged: {
          context: [],
          target: [{ author: "a", text: "😭".repeat(400) }],
        },
      }),
    );
    const line = kids(json)[2]?.content ?? "";
    expect(line).toBe(`> **a:** ${"😭".repeat(299)}…`);
    expect(line.isWellFormed()).toBe(true);
  });

  test("automod and miss verdicts are never posted", () => {
    expect(() => render(verdict({ kind: "automod" }))).toThrow();
    expect(() => render(verdict({ kind: "miss" }))).toThrow();
  });
});

describe("scoreBars", () => {
  test("yellow between the threshold and 0.85, plain below", () => {
    const lines = scoreBars({ scam: 0.72, hate: 0.1 }, 0.7)
      .split("\n")
      .slice(1, -1);
    expect(lines[0]).toStartWith("\u001b[1;33mscam");
    expect(lines[0]).toContain("◀");
    expect(lines[1]).toBe("hate 0.10 █░░░░░░░░░");
  });

  test("every bar has exactly 10 cells, markers only at or over the threshold", () => {
    const out = scoreBars({ scam: 0.91, promo: 0.72, hate: 0.1 }, 0.7);
    expect(out.startsWith("```ansi\n")).toBe(true);
    const lines = out.split("\n").slice(1, -1);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toStartWith("\u001b[1;31mscam");
    expect(lines[0]).toContain("0.91 " + "█".repeat(9) + "░ ◀");
    expect(lines[2]).not.toContain("◀");
    for (const l of lines) {
      // eslint-disable-next-line no-control-regex
      const plain = l.replace(/\u001b\[[\d;]+m/g, "");
      expect((plain.match(/[█░]/g) ?? []).length).toBe(10);
    }
  });

  test("out-of-range scores are clamped to the track", () => {
    const lines = scoreBars({ scam: 1.4, hate: -0.2 }, 0.7)
      .split("\n")
      .slice(1, -1)
      // eslint-disable-next-line no-control-regex
      .map((l) => l.replace(/\u001b\[[\d;]+m/g, ""));
    expect(lines[0]).toBe("scam 1.40 ██████████ ◀");
    expect(lines[1]).toBe("hate -0.20 ░░░░░░░░░░");
  });

  test("retired rule ids render after current rules", () => {
    const lines = scoreBars({ troll: 0.6, scam: 0.1 }, 0.7)
      .split("\n")
      .slice(1, -1);
    expect(lines[0]).toStartWith("scam");
    expect(lines[1]).toStartWith("troll");
  });
});
