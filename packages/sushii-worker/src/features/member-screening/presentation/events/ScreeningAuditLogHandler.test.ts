import { describe, expect, mock, test } from "bun:test";
import {
  AuditLogEvent,
  type Client,
  type Guild,
  type GuildAuditLogsEntry,
} from "discord.js";

import type { MemberScreeningService } from "../../application/MemberScreeningService";
import type { ScreeningGuildRepository } from "../../domain/repositories/ScreeningGuildRepository";
import {
  ScreeningAuditLogHandler,
  screeningActionFor,
} from "./ScreeningAuditLogHandler";

const GUILD = { id: "100000000000000001" } as Guild;
const BOT = "900000000000000001";
const MOD = "400000000000000001";
const USER = "200000000000000001";

function entry(overrides: Partial<GuildAuditLogsEntry>): GuildAuditLogsEntry {
  return {
    changes: [],
    targetId: USER,
    executorId: MOD,
    ...overrides,
  } as unknown as GuildAuditLogsEntry;
}

function setup(hasSettings = true) {
  const recordModAction = mock(async () => undefined);
  const wait = mock(async () => undefined);
  const handler = new ScreeningAuditLogHandler(
    { recordModAction } as unknown as MemberScreeningService,
    {
      findByGuildId: async () => (hasSettings ? { guildId: GUILD.id } : null),
    } as unknown as ScreeningGuildRepository,
    { user: { id: BOT } } as unknown as Client,
    wait,
  );
  return { handler, recordModAction, wait };
}

describe("screeningActionFor", () => {
  test("maps bans, kicks and new timeouts", () => {
    expect(
      screeningActionFor(entry({ action: AuditLogEvent.MemberBanAdd })),
    ).toBe("banned");
    expect(
      screeningActionFor(entry({ action: AuditLogEvent.MemberKick })),
    ).toBe("kicked");
    expect(
      screeningActionFor(
        entry({
          action: AuditLogEvent.MemberUpdate,
          changes: [
            {
              key: "communication_disabled_until",
              new: "2026-03-11T00:00:00Z",
            },
          ] as GuildAuditLogsEntry["changes"],
        }),
      ),
    ).toBe("timed out");
  });

  test("ignores removed timeouts and other updates", () => {
    expect(
      screeningActionFor(
        entry({
          action: AuditLogEvent.MemberUpdate,
          changes: [
            { key: "communication_disabled_until", old: "x" },
          ] as GuildAuditLogsEntry["changes"],
        }),
      ),
    ).toBeNull();
    expect(
      screeningActionFor(entry({ action: AuditLogEvent.MemberRoleUpdate })),
    ).toBeNull();
  });
});

describe("ScreeningAuditLogHandler", () => {
  test("credits a moderator's action without waiting", async () => {
    const t = setup();

    await t.handler.handle(entry({ action: AuditLogEvent.MemberKick }), GUILD);

    expect(t.wait).not.toHaveBeenCalled();
    expect(t.recordModAction).toHaveBeenCalledWith(
      GUILD.id,
      USER,
      "kicked",
      MOD,
    );
  });

  test("waits 5s for the bot's own actions and passes by: null", async () => {
    const t = setup();

    await t.handler.handle(
      entry({ action: AuditLogEvent.MemberBanAdd, executorId: BOT }),
      GUILD,
    );

    expect(t.wait).toHaveBeenCalledWith(5000);
    expect(t.recordModAction).toHaveBeenCalledWith(
      GUILD.id,
      USER,
      "banned",
      null,
    );
  });

  test("skips guilds without settings and unrelated actions", async () => {
    const noSettings = setup(false);
    await noSettings.handler.handle(
      entry({ action: AuditLogEvent.MemberBanAdd }),
      GUILD,
    );
    expect(noSettings.recordModAction).not.toHaveBeenCalled();

    const t = setup();
    await t.handler.handle(
      entry({ action: AuditLogEvent.MessageDelete }),
      GUILD,
    );
    expect(t.recordModAction).not.toHaveBeenCalled();
  });
});
