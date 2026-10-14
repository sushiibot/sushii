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
import {
  type AuditMemberSource,
  PermissionAuditService,
} from "./PermissionAuditService";

const GUILD_ID = "1000";
const MOD_ID = "2000";
const DAY = 24 * 60 * 60 * 1000;

function fakeModMember() {
  return {
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
}

function fakeGuild(options: { canViewAuditLog: boolean }): Guild {
  // Holds the mod, so a report built from the cache would look different.
  const members = new Collection([[MOD_ID, fakeModMember()]]);

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
      cache: new Collection(),
      me: { permissions: { has: () => options.canViewAuditLog } },
    },
  } as unknown as Guild;
}

describe("PermissionAuditService", () => {
  let coverage: PermissionUsageCoverage | null;
  let startIfNeeded: ReturnType<typeof mock>;
  let membersById: ReturnType<typeof mock>;
  let service: PermissionAuditService;

  beforeEach(() => {
    coverage = {
      trackingStartedAt: new Date(Date.now() - 60 * DAY),
      backfilledAt: new Date(),
      backfillCoverage: {},
    };
    startIfNeeded = mock(() => undefined);
    membersById = mock(() =>
      Promise.resolve({
        members: new Map([[MOD_ID, fakeModMember()]]),
        unresolvedIds: new Set(),
      }),
    );
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
        listSelfAssignableRoles: mock(() => Promise.resolve([])),
      } as unknown as PermissionAuditReadRepository,
      {
        get: mock(() => Promise.resolve(coverage)),
      } as unknown as PermissionUsageCoverageRepository,
      { startIfNeeded } as unknown as AuditLogBackfillService,
      {
        roleMemberCounts: mock(() => Promise.resolve(new Map([["50", 3]]))),
        membersById,
      } as unknown as AuditMemberSource,
      new Set(["BanMembers", "KickMembers"]),
      new Set(["MentionEveryone"]),
    );
  });

  test("reports unused permissions from holder counts and usage", async () => {
    const { report, context } = await service.generate(
      fakeGuild({ canViewAuditLog: true }),
    );

    const unused = report.findings.find(
      (f) => f.finding.type === "unused_role_permission",
    );
    expect(unused?.finding).toMatchObject({
      permissions: ["KickMembers"],
      holderCount: 3,
    });
    expect(
      report.findings.some((f) => f.finding.type === "dangerous_overwrite"),
    ).toBe(true);
    expect(context).toMatchObject({
      guildName: "Lisa Fan Server",
      canViewAuditLog: true,
      backfillPending: false,
    });
    expect(startIfNeeded).not.toHaveBeenCalled();
  });

  test("only fetches members who used a permission", async () => {
    const guild = fakeGuild({ canViewAuditLog: true });
    await service.generate(guild);

    expect(membersById).toHaveBeenCalledWith(guild, [MOD_ID]);
  });

  test("a user who left no longer holds the role", async () => {
    membersById.mockImplementation(() =>
      Promise.resolve({ members: new Map(), unresolvedIds: new Set() }),
    );

    const { report } = await service.generate(
      fakeGuild({ canViewAuditLog: true }),
    );

    expect(
      report.findings.find((f) => f.finding.type === "unused_role_permission")
        ?.finding,
    ).toMatchObject({ permissions: ["BanMembers", "KickMembers"] });
  });

  test("permissions of users who couldn't be fetched count as used", async () => {
    membersById.mockImplementation(() =>
      Promise.resolve({ members: new Map(), unresolvedIds: new Set([MOD_ID]) }),
    );

    const { report } = await service.generate(
      fakeGuild({ canViewAuditLog: true }),
    );

    expect(
      report.findings.find((f) => f.finding.type === "unused_role_permission")
        ?.finding,
    ).toMatchObject({ permissions: ["KickMembers"] });
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
