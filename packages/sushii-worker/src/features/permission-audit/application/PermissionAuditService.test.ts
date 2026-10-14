import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  Collection,
  type Guild,
  GuildMFALevel,
  OverwriteType,
  PermissionFlagsBits,
} from "discord.js";

import type { PermissionAuditReadRepository } from "../domain/PermissionAuditReadRepository";
import type {
  PermissionUsageCoverage,
  PermissionUsageCoverageRepository,
} from "../domain/PermissionUsageCoverageRepository";
import type { AuditLogBackfillService } from "../infrastructure/AuditLogBackfillService";
import { PermissionAuditService } from "./PermissionAuditService";

const GUILD_ID = "1000";
const MOD_ID = "2000";
const DAY = 24 * 60 * 60 * 1000;

function fakeGuild(options: { canViewAuditLog: boolean }): Guild {
  const modMember = {
    id: MOD_ID,
    user: { username: "jisoo", bot: false },
    joinedAt: new Date(Date.now() - 400 * DAY),
    roles: {
      cache: new Collection([
        [GUILD_ID, { id: GUILD_ID }],
        ["50", { id: "50" }],
      ]),
    },
  };
  const members = new Collection([[MOD_ID, modMember]]);

  const roles = new Collection([
    [
      GUILD_ID,
      {
        id: GUILD_ID,
        name: "@everyone",
        position: 0,
        permissions: { bitfield: PermissionFlagsBits.SendMessages },
        tags: null,
        createdAt: new Date(Date.now() - 900 * DAY),
        members,
      },
    ],
    [
      "50",
      {
        id: "50",
        name: "Mod",
        position: 5,
        permissions: {
          bitfield:
            PermissionFlagsBits.BanMembers | PermissionFlagsBits.KickMembers,
        },
        tags: null,
        createdAt: new Date(Date.now() - 900 * DAY),
        members,
      },
    ],
  ]);

  const channels = new Collection([
    [
      "c1",
      {
        id: "c1",
        name: "general",
        permissionOverwrites: {
          cache: new Collection([
            [
              "50",
              {
                id: "50",
                type: OverwriteType.Role,
                allow: { bitfield: PermissionFlagsBits.ManageWebhooks },
                deny: { bitfield: 0n },
              },
            ],
          ]),
        },
      },
    ],
  ]);

  return {
    id: GUILD_ID,
    name: "Lisa Fan Server",
    ownerId: "9999",
    mfaLevel: GuildMFALevel.Elevated,
    memberCount: 1,
    roles: { cache: roles },
    channels: { cache: channels },
    members: {
      cache: members,
      me: { permissions: { has: () => options.canViewAuditLog } },
    },
  } as unknown as Guild;
}

describe("PermissionAuditService", () => {
  let coverage: PermissionUsageCoverage | null;
  let startIfNeeded: ReturnType<typeof mock>;
  let lastActiveAt: ReturnType<typeof mock>;
  let service: PermissionAuditService;

  beforeEach(() => {
    coverage = {
      trackingStartedAt: new Date(Date.now() - 60 * DAY),
      backfilledAt: new Date(),
      backfillCoverage: {},
    };
    startIfNeeded = mock(() => undefined);
    lastActiveAt = mock(() => Promise.resolve(new Map([[MOD_ID, new Date()]])));
    service = new PermissionAuditService(
      {
        listUsage: mock(() =>
          Promise.resolve([
            {
              userId: MOD_ID,
              permission: "BanMembers",
              lastUsedAt: new Date(),
            },
          ]),
        ),
        lastActiveAt,
        listSelfAssignableRoles: mock(() => Promise.resolve([])),
      } as unknown as PermissionAuditReadRepository,
      {
        get: mock(() => Promise.resolve(coverage)),
      } as unknown as PermissionUsageCoverageRepository,
      { startIfNeeded } as unknown as AuditLogBackfillService,
      new Set(["BanMembers", "KickMembers"]),
      new Set(["MentionEveryone"]),
    );
  });

  test("reports unused permissions from cache and usage", async () => {
    const { report, context } = await service.generate(
      fakeGuild({ canViewAuditLog: true }),
    );

    const unused = report.findings.find(
      (f) => f.finding.type === "unused_role_permission",
    );
    expect(unused?.finding).toMatchObject({ permissions: ["KickMembers"] });
    expect(
      report.findings.some((f) => f.finding.type === "dangerous_overwrite"),
    ).toBe(true);
    expect(context).toMatchObject({
      guildName: "Lisa Fan Server",
      canViewAuditLog: true,
      backfillPending: false,
      cachedMembers: 1,
      totalMembers: 1,
    });
    expect(startIfNeeded).not.toHaveBeenCalled();
  });

  test("only looks up activity for dangerous role holders", async () => {
    await service.generate(fakeGuild({ canViewAuditLog: true }));

    expect(lastActiveAt).toHaveBeenCalledWith(GUILD_ID, [MOD_ID]);
  });

  test("starts the backfill without waiting when it hasn't run", async () => {
    coverage = null;

    const { context } = await service.generate(
      fakeGuild({ canViewAuditLog: true }),
    );

    expect(startIfNeeded).toHaveBeenCalledTimes(1);
    expect(context.backfillPending).toBe(true);
  });

  test("without audit log access nothing is called unused", async () => {
    coverage = null;

    const { report, context } = await service.generate(
      fakeGuild({ canViewAuditLog: false }),
    );

    expect(startIfNeeded).not.toHaveBeenCalled();
    expect(context.historyStart).toBeNull();
    expect(
      report.findings.some((f) => f.finding.type === "unused_role_permission"),
    ).toBe(false);
    expect(report.notTracked[0]?.permissions).toEqual([
      "BanMembers",
      "KickMembers",
    ]);
  });
});
