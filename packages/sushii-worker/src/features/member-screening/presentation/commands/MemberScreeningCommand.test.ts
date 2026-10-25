import { describe, expect, mock, test } from "bun:test";
import type { ChatInputCommandInteraction, REST } from "discord.js";
import {
  ChannelType,
  DiscordAPIError,
  MessageFlags,
  RESTJSONErrorCodes,
} from "discord.js";
import pino from "pino";

import type { ScreeningGuildRepository } from "../../domain/repositories/ScreeningGuildRepository";
import type { ScreeningVerdictRepository } from "../../domain/repositories/ScreeningVerdictRepository";
import type { ScreeningGuildSettings } from "../../domain/types";
import { SCREENING_DEFAULTS } from "../../domain/types";
import {
  MemberScreeningCommand,
  parseRules,
  validateLogChannel,
} from "./MemberScreeningCommand";

const GUILD = "100000000000000001";
const CHANNEL = "300000000000000001";

function restReturning(value: unknown): Pick<REST, "get"> {
  return { get: mock(() => Promise.resolve(value)) };
}

function restRejecting(err: unknown): Pick<REST, "get"> {
  return { get: mock(() => Promise.reject(err)) };
}

function apiError(code: number, status: number): DiscordAPIError {
  return new DiscordAPIError(
    { message: "error", code },
    code,
    status,
    "GET",
    `/channels/${CHANNEL}`,
    {},
  );
}

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

describe("validateLogChannel", () => {
  test("accepts a text channel in the guild", async () => {
    const rest = restReturning({
      id: CHANNEL,
      guild_id: GUILD,
      type: ChannelType.GuildText,
    });

    expect(await validateLogChannel(rest, GUILD, CHANNEL)).toBeNull();
    expect(rest.get).toHaveBeenCalledWith(`/channels/${CHANNEL}`);
  });

  test("accepts an announcement channel", async () => {
    const rest = restReturning({
      id: CHANNEL,
      guild_id: GUILD,
      type: ChannelType.GuildAnnouncement,
    });

    expect(await validateLogChannel(rest, GUILD, CHANNEL)).toBeNull();
  });

  test("rejects a malformed id without calling Discord", async () => {
    const rest = restReturning({});

    expect(await validateLogChannel(rest, GUILD, "abc")).toContain(
      "must be a channel ID",
    );
    expect(rest.get).not.toHaveBeenCalled();
  });

  test("rejects a channel in another guild", async () => {
    const rest = restReturning({
      id: CHANNEL,
      guild_id: "100000000000000002",
      type: ChannelType.GuildText,
    });

    expect(await validateLogChannel(rest, GUILD, CHANNEL)).toContain(
      "isn't in server",
    );
  });

  test("rejects a non-text channel", async () => {
    const rest = restReturning({
      id: CHANNEL,
      guild_id: GUILD,
      type: ChannelType.GuildVoice,
    });

    expect(await validateLogChannel(rest, GUILD, CHANNEL)).toContain(
      "text or announcement",
    );
  });

  test("unknown channel is a validation message", async () => {
    const rest = restRejecting(
      apiError(RESTJSONErrorCodes.UnknownChannel, 404),
    );

    expect(await validateLogChannel(rest, GUILD, CHANNEL)).toContain(
      "can't see",
    );
  });

  test("missing access is a validation message", async () => {
    const rest = restRejecting(apiError(RESTJSONErrorCodes.MissingAccess, 403));

    expect(await validateLogChannel(rest, GUILD, CHANNEL)).toContain(
      "can't see",
    );
  });

  test("other errors are rethrown", async () => {
    const rest = restRejecting(
      apiError(RESTJSONErrorCodes.MissingPermissions, 403),
    );

    await expect(
      validateLogChannel(rest, GUILD, CHANNEL),
    ).rejects.toBeInstanceOf(DiscordAPIError);

    await expect(
      validateLogChannel(restRejecting(new Error("network")), GUILD, CHANNEL),
    ).rejects.toThrow("network");
  });
});

const OWNER = "400000000000000001";

function settings(): ScreeningGuildSettings {
  return {
    guildId: GUILD,
    logChannelId: CHANNEL,
    ...SCREENING_DEFAULTS,
    rules: null,
    enabledBy: OWNER,
    enabledAt: new Date("2026-03-01T00:00:00Z"),
  };
}

function setupCommand(ownerUserId: string | undefined) {
  const guildRepo = {
    list: mock(async () => [settings()]),
    upsert: mock(async (s: ScreeningGuildSettings) => s),
    delete: mock(async () => true),
  };
  const verdictRepo = { statsSince: mock(async () => []) };
  const command = new MemberScreeningCommand(
    guildRepo as unknown as ScreeningGuildRepository,
    verdictRepo as unknown as ScreeningVerdictRepository,
    ownerUserId,
    pino({ level: "silent" }),
  );
  return { command, guildRepo };
}

function configureInteraction(
  userId: string,
  integers: Record<string, number> = {},
) {
  return {
    user: { id: userId },
    options: {
      getSubcommand: () => "configure",
      getString: (name: string) => (name === "guild_id" ? GUILD : null),
      getInteger: (name: string) => integers[name] ?? null,
      getNumber: () => null,
      getBoolean: () => null,
    },
    reply: mock(async () => undefined),
    deferReply: mock(async () => undefined),
    editReply: mock(async (_reply: unknown) => undefined),
  };
}

async function runCommand(
  command: MemberScreeningCommand,
  interaction: ReturnType<typeof configureInteraction>,
) {
  await command.handler(interaction as unknown as ChatInputCommandInteraction);
}

function editedText(
  interaction: ReturnType<typeof configureInteraction>,
): string {
  return JSON.stringify(interaction.editReply.mock.calls[0]?.[0]);
}

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
    expect(t.guildRepo.upsert).not.toHaveBeenCalled();
  });

  test("lets the owner through", async () => {
    const t = setupCommand(OWNER);
    const interaction = configureInteraction(OWNER);

    await runCommand(t.command, interaction);

    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.deferReply).toHaveBeenCalledTimes(1);
    expect(t.guildRepo.upsert).toHaveBeenCalledTimes(1);
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

    expect(t.guildRepo.upsert).not.toHaveBeenCalled();
    expect(editedText(interaction)).toContain(`\`${name}\` must be between 1`);
  });

  test("accepts the bounds themselves", async () => {
    const t = setupCommand(OWNER);
    const interaction = configureInteraction(OWNER, {
      window_hours: 168,
      max_messages: 200,
    });

    await runCommand(t.command, interaction);

    expect(t.guildRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ windowHours: 168, maxMessages: 200 }),
    );
  });
});
