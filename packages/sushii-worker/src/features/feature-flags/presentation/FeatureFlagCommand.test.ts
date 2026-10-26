import { describe, expect, mock, test } from "bun:test";
import type { ChatInputCommandInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import pino from "pino";

import type { ScreeningSettingsState } from "@/features/member-screening/application/ScreeningSettingsPort";

import type { FeatureFlagEntry } from "../domain/FeatureFlag";
import type { FeatureFlagRepository } from "../domain/FeatureFlagRepository";
import { FeatureFlagCommand, buildFlagList } from "./FeatureFlagCommand";

const OWNER = "150443906511667200";
const GUILD_ONE = "187450744427773963";
const GUILD_TWO = "138194444645040128";
const CHANNEL = "1029384756102938400";

function entry(guildId: string, unixSeconds: number): FeatureFlagEntry {
  return {
    guildId,
    flag: "member_screening",
    enabledBy: OWNER,
    enabledAt: new Date(unixSeconds * 1000),
  };
}

function setup(
  opts: {
    ownerUserId?: string;
    entries?: FeatureFlagEntry[];
    disabled?: boolean;
    states?: Record<string, ScreeningSettingsState | null>;
    screening?: boolean;
  } = {},
) {
  const repo = {
    isEnabled: mock(async () => false),
    listGuilds: mock(async () => opts.entries ?? []),
    enable: mock(async () => undefined),
    disable: mock(async () => opts.disabled ?? true),
  };
  const screening = {
    getState: mock(async (guildId: string) => opts.states?.[guildId] ?? null),
  };
  const command = new FeatureFlagCommand(
    repo as FeatureFlagRepository,
    opts.screening === false ? null : screening,
    "ownerUserId" in opts ? opts.ownerUserId : OWNER,
    pino({ level: "silent" }),
  );
  return { command, repo, screening };
}

function interaction(
  sub: string,
  strings: Record<string, string>,
  guildNames: Record<string, string> = {},
) {
  return {
    user: { id: OWNER },
    options: {
      getSubcommand: () => sub,
      getString: (name: string) => strings[name] ?? null,
    },
    client: {
      rest: {
        get: mock(async (route: string) => {
          const id = route.split("/").pop() ?? "";
          if (!(id in guildNames)) {
            throw new Error("Unknown Guild");
          }
          return { id, name: guildNames[id] };
        }),
      },
    },
    reply: mock(async (_reply: unknown) => undefined),
    deferReply: mock(async (_opts: unknown) => undefined),
    editReply: mock(async (_reply: unknown) => undefined),
  };
}

type TestInteraction = ReturnType<typeof interaction>;

async function run(command: FeatureFlagCommand, i: TestInteraction) {
  await command.handler(i as unknown as ChatInputCommandInteraction);
}

function edited(i: TestInteraction) {
  const reply = i.editReply.mock.calls[0]?.[0] as {
    components: { toJSON(): unknown }[];
    flags: number;
    allowedMentions: unknown;
  };
  return {
    ...reply,
    components: reply.components.map((c) => c.toJSON()),
  };
}

describe("FeatureFlagCommand definition", () => {
  test("registers enable, disable and list with flag choices", () => {
    const { command } = setup();
    const json = command.command;

    expect(command.registeredGuilds).toEqual(["418504865543749642"]);
    expect(json.name).toBe("feature-flag");
    expect(json.options?.map((o) => o.name)).toEqual([
      "enable",
      "disable",
      "list",
    ]);
    expect(JSON.stringify(json)).toContain(
      '"choices":[{"name":"member_screening","value":"member_screening"}]',
    );
  });
});

describe("FeatureFlagCommand owner check", () => {
  test.each([
    ["unset", undefined],
    ["a different user", "400000000000000002"],
  ])("refuses when the owner is %s", async (_label, ownerUserId) => {
    const t = setup({ ownerUserId });
    const i = interaction("enable", {
      guild_id: GUILD_TWO,
      flag: "member_screening",
    });

    await run(t.command, i);

    expect(i.reply).toHaveBeenCalledWith({
      content: "Only the bot owner can use this.",
      flags: MessageFlags.Ephemeral,
    });
    expect(i.deferReply).not.toHaveBeenCalled();
    expect(t.repo.enable).not.toHaveBeenCalled();
  });
});

describe("FeatureFlagCommand enable", () => {
  test("enables the flag and matches the preview", async () => {
    const t = setup();
    const i = interaction(
      "enable",
      { guild_id: GUILD_TWO, flag: "member_screening" },
      { [GUILD_TWO]: "Server Two" },
    );

    await run(t.command, i);

    expect(i.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
    expect(t.repo.enable).toHaveBeenCalledWith(
      GUILD_TWO,
      "member_screening",
      OWNER,
    );
    expect(edited(i)).toEqual({
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
      components: [
        {
          type: 17,
          accent_color: 5763719,
          components: [
            {
              type: 10,
              content:
                "Enabled `member_screening` for **Server Two** (`138194444645040128`).\n-# Server moderators can now set it up in `/settings` → Automod. It can take up to a minute to show up there.",
            },
          ],
        },
      ],
    });
  });

  test("falls back to the ID when the guild name can't be fetched", async () => {
    const t = setup();
    const i = interaction("enable", {
      guild_id: GUILD_TWO,
      flag: "member_screening",
    });

    await run(t.command, i);

    expect(JSON.stringify(edited(i))).toContain(
      "Enabled `member_screening` for `138194444645040128`.",
    );
  });

  test("rejects a malformed guild ID", async () => {
    const t = setup();
    const i = interaction("enable", {
      guild_id: "abc",
      flag: "member_screening",
    });

    await run(t.command, i);

    expect(t.repo.enable).not.toHaveBeenCalled();
    expect(JSON.stringify(edited(i))).toContain(
      "`guild_id` must be a server ID.",
    );
  });

  test("rejects an unknown flag", async () => {
    const t = setup();
    const i = interaction("enable", { guild_id: GUILD_TWO, flag: "nope" });

    await run(t.command, i);

    expect(t.repo.enable).not.toHaveBeenCalled();
    expect(JSON.stringify(edited(i))).toContain("`flag` must be one of");
  });
});

describe("FeatureFlagCommand disable", () => {
  test("disables the flag", async () => {
    const t = setup();
    const i = interaction(
      "disable",
      { guild_id: GUILD_TWO, flag: "member_screening" },
      { [GUILD_TWO]: "Server Two" },
    );

    await run(t.command, i);

    expect(t.repo.disable).toHaveBeenCalledWith(GUILD_TWO, "member_screening");
    expect(JSON.stringify(edited(i))).toContain(
      "Disabled `member_screening` for **Server Two** (`138194444645040128`).",
    );
  });

  test("says when the flag wasn't on", async () => {
    const t = setup({ disabled: false });
    const i = interaction("disable", {
      guild_id: GUILD_TWO,
      flag: "member_screening",
    });

    await run(t.command, i);

    expect(JSON.stringify(edited(i))).toContain(
      "`member_screening` isn't on for `138194444645040128`.",
    );
  });
});

describe("FeatureFlagCommand list", () => {
  test("matches the preview blocks, newest first", async () => {
    const t = setup({
      entries: [entry(GUILD_ONE, 1792900000), entry(GUILD_TWO, 1792920000)],
      states: {
        [GUILD_ONE]: {
          enabled: true,
          logChannelId: CHANNEL,
          checkAvatars: true,
        },
        [GUILD_TWO]: { enabled: true, logChannelId: null, checkAvatars: true },
      },
    });
    const i = interaction(
      "list",
      { flag: "member_screening" },
      { [GUILD_ONE]: "Server One", [GUILD_TWO]: "Server Two" },
    );

    await run(t.command, i);

    expect(t.repo.listGuilds).toHaveBeenCalledWith("member_screening");
    expect(edited(i)).toEqual({
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
      components: [
        {
          type: 17,
          components: [
            {
              type: 10,
              content: "## Feature flags\n-# `member_screening` · 2 servers",
            },
            { type: 14, divider: true, spacing: 2 },
            {
              type: 10,
              content:
                "### Server Two\n-# `138194444645040128` · enabled by <@150443906511667200> <t:1792920000:R>\n⚠️ Flag on — waiting for mods to pick a log channel",
            },
            { type: 14, divider: true, spacing: 2 },
            {
              type: 10,
              content:
                "### Server One\n-# `187450744427773963` · enabled by <@150443906511667200> <t:1792900000:R>\n✅ Screening on · posting to <#1029384756102938400>",
            },
          ],
        },
      ],
    });
  });

  test("shows off when mods haven't turned screening on", async () => {
    const t = setup({
      entries: [entry(GUILD_ONE, 1792900000), entry(GUILD_TWO, 1792920000)],
      states: {
        [GUILD_ONE]: {
          enabled: false,
          logChannelId: CHANNEL,
          checkAvatars: true,
        },
      },
    });
    const i = interaction("list", { flag: "member_screening" });

    await run(t.command, i);

    const text = JSON.stringify(edited(i));
    expect(text.match(/Off — mods haven't turned it on/g)).toHaveLength(2);
    expect(text).toContain("### 187450744427773963");
  });

  test("omits the screening line without a screening reader", async () => {
    const t = setup({
      screening: false,
      entries: [entry(GUILD_ONE, 1792900000)],
    });
    const i = interaction("list", { flag: "member_screening" });

    await run(t.command, i);

    const text = JSON.stringify(edited(i));
    expect(text).toContain("1 server");
    expect(text).not.toContain("Screening on");
    expect(text).not.toContain("Off —");
  });
});

describe("FeatureFlagCommand list failures", () => {
  function contents(i: TestInteraction): string[] {
    const [container] = edited(i).components as {
      components: { type: number; content?: string }[];
    }[];
    return container.components
      .filter((c) => c.type === 10)
      .map((c) => c.content ?? "");
  }

  test("a guild whose state can't be read shows a neutral line", async () => {
    const t = setup({ entries: [entry(GUILD_ONE, 1), entry(GUILD_TWO, 2)] });
    t.screening.getState.mockImplementation(async (guildId: string) => {
      if (guildId === GUILD_ONE) {
        throw new Error("db down");
      }
      return { enabled: true, logChannelId: CHANNEL, checkAvatars: true };
    });
    const i = interaction("list", { flag: "member_screening" });

    await run(t.command, i);

    const [, two, one] = contents(i);
    expect(one.split("\n").at(-1)).toBe("Screening state unavailable");
    expect(two).toContain("✅ Screening on");
  });

  test("escapes guild names", async () => {
    const t = setup({ entries: [entry(GUILD_ONE, 1)] });
    const i = interaction(
      "list",
      { flag: "member_screening" },
      { [GUILD_ONE]: "**bold** _x_" },
    );

    await run(t.command, i);

    expect(contents(i)[1].split("\n")[0]).toBe("### \\*\\*bold\\*\\* \\_x\\_");
  });
});

describe("buildFlagList", () => {
  test("empty state", () => {
    const json = buildFlagList("member_screening", []).toJSON();

    expect(json.components).toEqual([
      {
        type: 10,
        content: "## Feature flags\n-# `member_screening` · 0 servers",
      },
      {
        type: 10,
        content:
          "No servers have this flag yet.\n-# Turn it on with `/feature-flag enable`.",
      },
    ]);
  });

  test("caps the guilds shown and counts the rest", () => {
    const guilds = Array.from({ length: 20 }, (_, n) => ({
      entry: entry(`1000000000000000${String(n).padStart(2, "0")}`, 1),
      name: undefined,
      screening: null,
    }));

    const json = buildFlagList("member_screening", guilds).toJSON();

    expect(json.components).toHaveLength(1 + 15 * 2 + 1);
    expect(json.components.at(-1)).toEqual({
      type: 10,
      content: "-# …and 5 more",
    });
    expect(JSON.stringify(json.components[0])).toContain("20 servers");
  });
});
