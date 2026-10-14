import { describe, expect, test } from "bun:test";
import { AuditLogEvent } from "discord.js";

import {
  type AuditLogEntryInput,
  AuditLogUsageDetector,
} from "./AuditLogUsageDetector";

const SUSHII_ID = "100000000000000001";
const GUILD_ID = "200000000000000002";
const MOD_ID = "300000000000000003";
const TARGET_ID = "400000000000000004";
const OCCURRED_AT = new Date("2026-10-01T00:00:00Z");

function entry(overrides: Partial<AuditLogEntryInput>): AuditLogEntryInput {
  return {
    guildId: GUILD_ID,
    action: AuditLogEvent.MemberBanAdd,
    executorId: MOD_ID,
    targetId: TARGET_ID,
    channelId: null,
    changeKeys: [],
    occurredAt: OCCURRED_AT,
    ...overrides,
  };
}

function permissions(input: AuditLogEntryInput): string[] {
  return new AuditLogUsageDetector(() => SUSHII_ID)
    .detect(input)
    .map((usage) => usage.permission);
}

describe("AuditLogUsageDetector", () => {
  test("attributes a ban to the executor", () => {
    const usages = new AuditLogUsageDetector(() => SUSHII_ID).detect(entry({}));

    expect(usages).toEqual([
      {
        guildId: GUILD_ID,
        userId: MOD_ID,
        permission: "BanMembers",
        source: "audit_log",
        channelId: null,
        occurredAt: OCCURRED_AT,
      },
    ]);
  });

  test("skips sushii's own entries", () => {
    expect(permissions(entry({ executorId: SUSHII_ID }))).toEqual([]);
  });

  test("credits other bots to the bot itself", () => {
    const otherBot = "500000000000000005";
    const usages = new AuditLogUsageDetector(() => SUSHII_ID).detect(
      entry({ executorId: otherBot }),
    );

    expect(usages.map((usage) => usage.userId)).toEqual([otherBot]);
  });

  test("skips entries with no executor", () => {
    expect(permissions(entry({ executorId: null }))).toEqual([]);
  });

  test("skips unmapped actions", () => {
    expect(
      permissions(entry({ action: AuditLogEvent.AutoModerationBlockMessage })),
    ).toEqual([]);
  });

  test("maps member update change keys", () => {
    expect(
      permissions(
        entry({
          action: AuditLogEvent.MemberUpdate,
          changeKeys: ["communication_disabled_until", "nick", "mute", "deaf"],
        }),
      ),
    ).toEqual([
      "ModerateMembers",
      "ManageNicknames",
      "MuteMembers",
      "DeafenMembers",
    ]);
  });

  test("ignores unknown member update keys", () => {
    expect(
      permissions(
        entry({ action: AuditLogEvent.MemberUpdate, changeKeys: ["avatar"] }),
      ),
    ).toEqual([]);
  });

  test.each([
    AuditLogEvent.MemberUpdate,
    AuditLogEvent.MemberRoleUpdate,
    AuditLogEvent.MessageDelete,
  ])("action %p on yourself is not evidence", (action) => {
    expect(
      permissions(entry({ action, targetId: MOD_ID, changeKeys: ["nick"] })),
    ).toEqual([]);
  });

  test("role update on someone else is Manage Roles", () => {
    expect(
      permissions(entry({ action: AuditLogEvent.MemberRoleUpdate })),
    ).toEqual(["ManageRoles"]);
  });

  test("pins map to Pin Messages, not Manage Messages", () => {
    expect(permissions(entry({ action: AuditLogEvent.MessagePin }))).toEqual([
      "PinMessages",
    ]);
  });

  test("creating an emoji only needs Create Expressions", () => {
    expect(permissions(entry({ action: AuditLogEvent.EmojiCreate }))).toEqual([
      "CreateGuildExpressions",
    ]);
  });

  describe("threads", () => {
    const action = AuditLogEvent.ThreadUpdate;

    test("editing someone else's thread is Manage Threads", () => {
      expect(permissions(entry({ action, targetOwnerId: TARGET_ID }))).toEqual([
        "ManageThreads",
      ]);
    });

    test("editing your own thread is not evidence", () => {
      expect(permissions(entry({ action, targetOwnerId: MOD_ID }))).toEqual([]);
    });

    test("unknown owner is not evidence", () => {
      expect(permissions(entry({ action, targetOwnerId: null }))).toEqual([]);
    });
  });

  test("observes every permission it can emit", () => {
    const detector = new AuditLogUsageDetector(() => SUSHII_ID);

    expect(detector.observes).toContain("ManageThreads");
    expect(detector.observes).toContain("ManageNicknames");
    expect(detector.observes).toContain("ManageMessages");
    expect(detector.observes).not.toContain("Administrator");
    expect(new Set(detector.observes).size).toBe(detector.observes.length);
  });
});
