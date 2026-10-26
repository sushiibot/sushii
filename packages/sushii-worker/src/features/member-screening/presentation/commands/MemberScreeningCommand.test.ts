import { describe, expect, mock, test } from "bun:test";
import type { ChatInputCommandInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import pino from "pino";

import type { FeatureFlagEntry } from "@/features/feature-flags/domain/FeatureFlag";
import type { FeatureFlagRepository } from "@/features/feature-flags/domain/FeatureFlagRepository";

import type {
  ScreeningGuildPatch,
  ScreeningGuildRepository,
} from "../../domain/repositories/ScreeningGuildRepository";
import type { ScreeningVerdictRepository } from "../../domain/repositories/ScreeningVerdictRepository";
import type { ScreeningGuildSettings } from "../../domain/types";
import {
  SCREENING_DEFAULTS,
  defaultScreeningSettings,
} from "../../domain/types";
import { MemberScreeningCommand, parseRules } from "./MemberScreeningCommand";

const GUILD = "100000000000000001";
const CHANNEL = "300000000000000001";

describe("parseRules", () => {
  test("default resets to null", () => {
    expect(parseRules(" Default ")).toEqual({ ok: true, rules: null });
  });

  test("accepts mixed case and whitespace", () => {
    expect(parseRules("Scam, SALE ,promo")).toEqual({
      ok: true,
      rules: ["scam", "sale", "promo"],
    });
  });

  test("dedupes repeated ids", () => {
    expect(parseRules("scam,scam,sale")).toEqual({
      ok: true,
      rules: ["scam", "sale"],
    });
  });

  test("rejects empty input", () => {
    expect(parseRules(" , ")).toEqual({ ok: false, invalid: [] });
  });

  test("reports unknown ids", () => {
    expect(parseRules("scam,spam,nope")).toEqual({
      ok: false,
      invalid: ["spam", "nope"],
    });
  });
});

const OWNER = "400000000000000001";

function settings(
  overrides: Partial<ScreeningGuildSettings> = {},
): ScreeningGuildSettings {
  return {
    guildId: GUILD,
    logChannelId: CHANNEL,
    ...SCREENING_DEFAULTS,
    rules: null,
    enabled: true,
    ...overrides,
  };
}

function setupCommand(
  ownerUserId: string | undefined,
  opts: {
    flagOn?: boolean;
    rows?: ScreeningGuildSettings[];
    flagged?: FeatureFlagEntry[];
  } = {},
) {
  const guildRepo = {
    list: mock(async () => opts.rows ?? [settings()]),
    patch: mock(async (guildId: string, changes: ScreeningGuildPatch) => ({
      ...defaultScreeningSettings(guildId),
      ...changes,
    })),
  };
  const flagRepo = {
    isEnabled: mock(async () => opts.flagOn ?? true),
    listGuilds: mock(async () => opts.flagged ?? []),
  };
  const verdictRepo = { statsSince: mock(async () => []) };
  const command = new MemberScreeningCommand(
    guildRepo as unknown as ScreeningGuildRepository,
    flagRepo as unknown as FeatureFlagRepository,
    verdictRepo as unknown as ScreeningVerdictRepository,
    ownerUserId,
    pino({ level: "silent" }),
  );
  return { command, guildRepo, flagRepo };
}

function interactionFor(
  sub: string,
  userId: string,
  values: {
    strings?: Record<string, string>;
    integers?: Record<string, number>;
    booleans?: Record<string, boolean>;
  } = {},
) {
  const strings: Record<string, string> = {
    guild_id: GUILD,
    ...values.strings,
  };
  return {
    user: { id: userId },
    options: {
      getSubcommand: () => sub,
      getString: (name: string) => strings[name] ?? null,
      getInteger: (name: string) => values.integers?.[name] ?? null,
      getNumber: () => null,
      getBoolean: (name: string) => values.booleans?.[name] ?? null,
    },
    client: { rest: { get: mock(async (_route: string) => ({})) } },
    reply: mock(async () => undefined),
    deferReply: mock(async () => undefined),
    editReply: mock(async (_reply: unknown) => undefined),
  };
}

function configureInteraction(
  userId: string,
  integers: Record<string, number> = {},
) {
  return interactionFor("configure", userId, { integers });
}

type TestInteraction = ReturnType<typeof interactionFor>;

async function runCommand(
  command: MemberScreeningCommand,
  interaction: TestInteraction,
) {
  await command.handler(interaction as unknown as ChatInputCommandInteraction);
}

function editedText(interaction: TestInteraction): string {
  return JSON.stringify(interaction.editReply.mock.calls[0]?.[0]);
}

describe("MemberScreeningCommand definition", () => {
  test("only has configure and status", () => {
    const t = setupCommand(OWNER);

    expect(t.command.command.options?.map((o) => o.name)).toEqual([
      "configure",
      "status",
    ]);
  });

  test("configure leaves the log channel and avatar checks to moderators", () => {
    const t = setupCommand(OWNER);
    const configure = t.command.command.options?.find(
      (o) => o.name === "configure",
    ) as { options?: { name: string }[] } | undefined;

    expect(configure?.options?.map((o) => o.name)).toEqual([
      "guild_id",
      "max_messages",
      "window_hours",
      "review_threshold",
      "rules",
      "daily_check_cap",
    ]);
  });
});

describe("MemberScreeningCommand owner check", () => {
  test.each([
    ["unset", undefined],
    ["a different user", "400000000000000002"],
  ])("refuses when the owner is %s", async (_label, ownerUserId) => {
    const t = setupCommand(ownerUserId);
    const interaction = configureInteraction(OWNER);

    await runCommand(t.command, interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Only the bot owner can use this.",
      flags: MessageFlags.Ephemeral,
    });
    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(t.guildRepo.list).not.toHaveBeenCalled();
    expect(t.guildRepo.patch).not.toHaveBeenCalled();
  });

  test("lets the owner through", async () => {
    const t = setupCommand(OWNER);
    const interaction = configureInteraction(OWNER);

    await runCommand(t.command, interaction);

    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.deferReply).toHaveBeenCalledTimes(1);
    expect(t.guildRepo.patch).toHaveBeenCalledTimes(1);
  });
});

describe("MemberScreeningCommand configure", () => {
  test("patches only the given fields", async () => {
    const t = setupCommand(OWNER);
    const interaction = interactionFor("configure", OWNER, {
      strings: { rules: "scam,sale" },
      integers: { max_messages: 10 },
    });

    await runCommand(t.command, interaction);

    expect(t.guildRepo.patch).toHaveBeenCalledTimes(1);
    const [guildId, changes] = t.guildRepo.patch.mock.calls[0];
    expect(guildId).toBe(GUILD);
    expect(
      Object.fromEntries(
        Object.entries(changes).filter(([, v]) => v !== undefined),
      ),
    ).toEqual({
      rules: ["scam", "sale"],
      maxMessages: 10,
    });
    expect(t.guildRepo.list).not.toHaveBeenCalled();
  });

  test("notes when the flag is off", async () => {
    const t = setupCommand(OWNER, { flagOn: false });
    const interaction = configureInteraction(OWNER);

    await runCommand(t.command, interaction);

    expect(t.guildRepo.patch).toHaveBeenCalledTimes(1);
    expect(editedText(interaction)).toContain(
      "The `member_screening` flag is off for this server",
    );
  });

  test("no flag note when the flag is on", async () => {
    const t = setupCommand(OWNER);
    const interaction = configureInteraction(OWNER);

    await runCommand(t.command, interaction);

    expect(editedText(interaction)).not.toContain("flag is off");
  });
});

describe("MemberScreeningCommand status", () => {
  test("lists flagged guilds as active or inactive", async () => {
    const other = "100000000000000002";
    const third = "100000000000000003";
    const t = setupCommand(OWNER, {
      rows: [
        settings(),
        settings({ guildId: other, enabled: false }),
        settings({ guildId: "100000000000000009" }),
      ],
      flagged: [GUILD, other, third].map((guildId) => ({
        guildId,
        flag: "member_screening",
        enabledBy: OWNER,
        enabledAt: new Date("2026-10-01T00:00:00Z"),
      })),
    });
    const interaction = interactionFor("status", OWNER);

    await runCommand(t.command, interaction);

    const text = editedText(interaction);
    expect(text).toContain("3 servers flagged · 1 active");
    expect(text).toContain(`\`${GUILD}\` · ✅ active · logs to <#${CHANNEL}>`);
    expect(text).toContain(
      `\`${other}\` · ⏸️ inactive · mods haven't turned it on`,
    );
    expect(text).toContain(
      `\`${third}\` · ⏸️ inactive · mods haven't turned it on`,
    );
    expect(text).not.toContain("100000000000000009");
    expect(t.flagRepo.listGuilds).toHaveBeenCalledWith("member_screening");
  });
});

describe("MemberScreeningCommand configure bounds", () => {
  test.each([
    ["window_hours", 0],
    ["window_hours", 169],
    ["max_messages", 0],
    ["max_messages", 201],
  ])("rejects %s = %d", async (name, value) => {
    const t = setupCommand(OWNER);
    const interaction = configureInteraction(OWNER, { [name]: value });

    await runCommand(t.command, interaction);

    expect(t.guildRepo.patch).not.toHaveBeenCalled();
    expect(editedText(interaction)).toContain(`\`${name}\` must be between 1`);
  });

  test("accepts the bounds themselves", async () => {
    const t = setupCommand(OWNER);
    const interaction = configureInteraction(OWNER, {
      window_hours: 168,
      max_messages: 200,
    });

    await runCommand(t.command, interaction);

    expect(t.guildRepo.patch).toHaveBeenCalledWith(
      GUILD,
      expect.objectContaining({ windowHours: 168, maxMessages: 200 }),
    );
  });
});
