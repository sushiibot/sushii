import { describe, expect, mock, test } from "bun:test";
import type { GuildMember } from "discord.js";
import { DiscordAPIError, RESTJSONErrorCodes } from "discord.js";
import pino from "pino";

import { GuildConfig } from "@/shared/domain/entities/GuildConfig";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import { MemberLogService } from "./MemberLogService";

const GUILD = "100000000000000001";
const CHANNEL = "300000000000000001";
const USER = "500000000000000001";

function apiError(code: number): DiscordAPIError {
  const err = Object.create(DiscordAPIError.prototype) as DiscordAPIError;
  (err as unknown as { code: number }).code = code;
  return err;
}

function setup(sendError: unknown) {
  const config = GuildConfig.createDefault(GUILD)
    .updateLogChannel("member", CHANNEL)
    .setLoggingEnabled("member", true);
  const repo = {
    findByGuildId: mock(async () => config),
    save: mock(async (c: GuildConfig) => c),
  } satisfies GuildConfigRepository;

  const channel = {
    id: CHANNEL,
    guild: { id: GUILD },
    isTextBased: () => true,
    send: mock(async () => {
      throw sendError;
    }),
  };

  const member = {
    guild: { id: GUILD, channels: { cache: { get: () => channel } } },
    nickname: null,
    joinedAt: null,
    user: {
      id: USER,
      tag: "user",
      displayName: "user",
      createdAt: new Date("2020-01-01T00:00:00Z"),
      displayAvatarURL: () => "https://cdn.discordapp.com/embed/avatars/0.png",
      toString: () => `<@${USER}>`,
    },
  } as unknown as GuildMember;

  return {
    service: new MemberLogService(repo, pino({ level: "silent" })),
    repo,
    member,
  };
}

describe("MemberLogService deleted log channel", () => {
  test("clears the channel and turns the member log off", async () => {
    const t = setup(apiError(RESTJSONErrorCodes.UnknownChannel));

    await t.service.logMemberJoin(t.member);

    expect(t.repo.save).toHaveBeenCalledTimes(1);
    const saved = t.repo.save.mock.calls[0][0];
    expect(saved.loggingSettings.memberLogChannel).toBeNull();
    expect(saved.loggingSettings.memberLogEnabled).toBe(false);
  });

  test("a missing-access error keeps the config", async () => {
    const t = setup(apiError(RESTJSONErrorCodes.MissingAccess));

    await t.service.logMemberJoin(t.member);

    expect(t.repo.save).not.toHaveBeenCalled();
  });
});
