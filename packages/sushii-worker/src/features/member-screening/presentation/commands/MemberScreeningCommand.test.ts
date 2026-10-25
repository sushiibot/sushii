import { describe, expect, mock, test } from "bun:test";
import type { REST } from "discord.js";
import { ChannelType, DiscordAPIError, RESTJSONErrorCodes } from "discord.js";

import { parseRules, validateLogChannel } from "./MemberScreeningCommand";

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
