import { describe, expect, mock, test } from "bun:test";
import {
  type AutoModerationActionExecution,
  AutoModerationActionType,
} from "discord.js";
import pino from "pino";

import type { MemberScreeningService } from "../../application/MemberScreeningService";
import type { ScreeningGuildRepository } from "../../domain/repositories/ScreeningGuildRepository";
import { ScreeningAutomodHandler } from "./ScreeningAutomodHandler";

const GUILD = "100000000000000001";
const USER = "200000000000000001";
const NOW = new Date("2026-03-10T12:00:00Z").getTime();
const HOUR_MS = 60 * 60 * 1000;

function member(joinedHoursAgo: number) {
  return {
    id: USER,
    joinedAt: new Date(NOW - joinedHoursAgo * HOUR_MS),
    roles: { cache: new Map() },
  };
}

function setup(
  opts: {
    type?: AutoModerationActionType;
    cachedMember?: ReturnType<typeof member> | null;
    fetchedMember?: ReturnType<typeof member>;
    ruleFetchFails?: boolean;
    settingsFail?: boolean;
  } = {},
) {
  const recordAutomodBlock = mock(async () => undefined);
  const membersFetch = mock(async () => opts.fetchedMember ?? member(1));
  const rulesFetch = mock(async () => {
    if (opts.ruleFetchFails) {
      throw new Error("Missing Permissions");
    }
    return { name: "Fetched rule" };
  });
  const guild = {
    id: GUILD,
    ownerId: "200000000000000009",
    roles: { cache: new Map() },
    members: { fetch: membersFetch },
    autoModerationRules: { fetch: rulesFetch },
  };
  const execution = {
    action: { type: opts.type ?? AutoModerationActionType.BlockMessage },
    guild,
    userId: USER,
    member: opts.cachedMember === undefined ? null : opts.cachedMember,
    autoModerationRule: null,
    ruleId: "910000000000000001",
    channelId: "300000000000000001",
    alertSystemMessageId: null,
    content: "blocked words",
  } as unknown as AutoModerationActionExecution;
  const handler = new ScreeningAutomodHandler(
    { recordAutomodBlock } as unknown as MemberScreeningService,
    {
      findByGuildId: async () => {
        if (opts.settingsFail) {
          throw new Error("connection refused");
        }
        return { guildId: GUILD, windowHours: 72 };
      },
    } as unknown as ScreeningGuildRepository,
    pino({ level: "silent" }),
    () => NOW,
  );
  return { handler, execution, recordAutomodBlock, membersFetch, rulesFetch };
}

describe("ScreeningAutomodHandler", () => {
  test("ignores actions other than BlockMessage", async () => {
    const t = setup({ type: AutoModerationActionType.SendAlertMessage });

    await t.handler.handle(t.execution);

    expect(t.membersFetch).not.toHaveBeenCalled();
    expect(t.recordAutomodBlock).not.toHaveBeenCalled();
  });

  test("skips the block when the settings lookup fails", async () => {
    const t = setup({ settingsFail: true });

    await t.handler.handle(t.execution);

    expect(t.membersFetch).not.toHaveBeenCalled();
    expect(t.recordAutomodBlock).not.toHaveBeenCalled();
  });

  test("fetches an uncached member and records the block", async () => {
    const t = setup();

    await t.handler.handle(t.execution);

    expect(t.membersFetch).toHaveBeenCalledWith(USER);
    expect(t.recordAutomodBlock).toHaveBeenCalledWith({
      guildId: GUILD,
      userId: USER,
      channelId: "300000000000000001",
      alertMessageId: null,
      ruleName: "Fetched rule",
      content: "blocked words",
      joinedAt: new Date(NOW - HOUR_MS),
    });
  });

  test("skips members outside the window before fetching the rule", async () => {
    const t = setup({ cachedMember: member(100) });

    await t.handler.handle(t.execution);

    expect(t.membersFetch).not.toHaveBeenCalled();
    expect(t.rulesFetch).not.toHaveBeenCalled();
    expect(t.recordAutomodBlock).not.toHaveBeenCalled();
  });

  test("falls back to a generic rule name when the rule fetch fails", async () => {
    const t = setup({ cachedMember: member(1), ruleFetchFails: true });

    await t.handler.handle(t.execution);

    expect(t.recordAutomodBlock).toHaveBeenCalledWith(
      expect.objectContaining({ ruleName: "AutoMod rule" }),
    );
  });
});
