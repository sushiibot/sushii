import { describe, expect, test } from "bun:test";
import { PermissionFlagsBits } from "discord.js";

import type { Finding } from "./Finding";
import type {
  GuildSnapshot,
  MemberSnapshot,
  RoleSnapshot,
  UsageSnapshot,
} from "./GuildSnapshot";
import type { PermissionName } from "./PermissionUsage";
import { analyzePermissions } from "./analyzePermissions";

const NOW = new Date("2026-10-13T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

const EVERYONE = "1000";
const GUILD = "1000";
const OWNER = "9000";

function bits(...permissions: PermissionName[]): bigint {
  return permissions.reduce((acc, p) => acc | PermissionFlagsBits[p], 0n);
}

function role(overrides: Partial<RoleSnapshot> & { id: string }): RoleSnapshot {
  return {
    name: `role-${overrides.id}`,
    position: 1,
    permissions: 0n,
    botUserId: null,
    createdAt: daysAgo(365),
    holderIds: [],
    holderCount: overrides.holderIds?.length ?? 0,
    ...overrides,
  };
}

function member(
  overrides: Partial<MemberSnapshot> & { id: string },
): MemberSnapshot {
  return {
    username: `user-${overrides.id}`,
    isBot: false,
    roleIds: [],
    joinedAt: daysAgo(365),
    ...overrides,
  };
}

interface Setup {
  roles?: RoleSnapshot[];
  members?: MemberSnapshot[];
  guild?: Partial<GuildSnapshot>;
  lastUsed?: Record<string, Partial<Record<PermissionName, Date>>>;
  /** Defaults to `lastUsed`: most fixtures model audit log evidence. */
  auditLogLastUsed?: Record<string, Partial<Record<PermissionName, Date>>>;
  observed?: PermissionName[];
  observedSince?: Date;
  unresolved?: PermissionName[];
}

function analyze(setup: Setup) {
  const roles = [role({ id: EVERYONE, position: 0 }), ...(setup.roles ?? [])];
  const members = setup.members ?? [];
  const guild: GuildSnapshot = {
    guildId: GUILD,
    ownerId: OWNER,
    everyoneRoleId: EVERYONE,
    mfaRequired: true,
    roles,
    overwrites: [],
    memberCount: 100,
    members: new Map(members.map((m) => [m.id, m])),
    selfAssignable: [],
    now: NOW,
    ...setup.guild,
  };
  const observed = setup.observed ?? [
    "BanMembers",
    "KickMembers",
    "ManageRoles",
    "ManageMessages",
    "ManageWebhooks",
    "ManageChannels",
  ];
  const toMap = (
    entries: Record<string, Partial<Record<PermissionName, Date>>>,
  ) =>
    new Map(
      Object.entries(entries).map(([userId, perms]) => [
        userId,
        new Map(Object.entries(perms) as [PermissionName, Date][]),
      ]),
    );
  const usage: UsageSnapshot = {
    lastUsed: toMap(setup.lastUsed ?? {}),
    auditLogLastUsed: toMap(setup.auditLogLastUsed ?? setup.lastUsed ?? {}),
    observedSince: new Map(
      observed.map((p) => [p, setup.observedSince ?? daysAgo(45)]),
    ),
    unresolved: new Set(setup.unresolved ?? []),
    backfillPending: false,
  };

  return analyzePermissions(guild, usage);
}

function findingsOf<T extends Finding["type"]>(
  report: ReturnType<typeof analyze>,
  type: T,
): Extract<Finding, { type: T }>[] {
  return report.findings
    .map((rated) => rated.finding)
    .filter((f): f is Extract<Finding, { type: T }> => f.type === type);
}

describe("analyzePermissions", () => {
  test("flags dangerous @everyone permissions", () => {
    const report = analyze({
      roles: [],
      guild: {
        roles: [
          role({
            id: EVERYONE,
            position: 0,
            permissions: bits("MentionEveryone", "SendMessages"),
          }),
        ],
      },
    });

    const [finding] = findingsOf(report, "everyone_dangerous");
    expect(finding?.permissions).toEqual(["MentionEveryone"]);
    expect(report.findings[0]?.severity).toBe("high");
  });

  describe("role usage", () => {
    const mods = [member({ id: "1" }), member({ id: "2" })];
    const modRole = role({
      id: "50",
      position: 5,
      permissions: bits("BanMembers", "ManageWebhooks"),
      holderIds: ["1", "2"],
    });

    test("unused when no holder used a tracked permission", () => {
      const report = analyze({
        roles: [modRole],
        members: mods,
        lastUsed: { "1": { BanMembers: daysAgo(3) } },
      });

      const [unused] = findingsOf(report, "unused_role_permission");
      expect(unused?.permissions).toEqual(["ManageWebhooks"]);
      expect(unused?.lowConfidence).toBe(false);
      expect(report.findings.find((f) => f.finding === unused)?.tab).toBe(
        "unused",
      );
    });

    test("usage older than 45 days doesn't count", () => {
      const report = analyze({
        roles: [modRole],
        members: mods,
        lastUsed: {
          "1": { BanMembers: daysAgo(50), ManageWebhooks: daysAgo(2) },
        },
      });

      const [unused] = findingsOf(report, "unused_role_permission");
      expect(unused?.permissions).toEqual(["BanMembers"]);
    });

    test("low confidence for a new role, with the unlock date", () => {
      const report = analyze({
        roles: [{ ...modRole, createdAt: daysAgo(4) }],
        members: mods,
      });

      const [unused] = findingsOf(report, "unused_role_permission");
      expect(unused?.lowConfidence).toBe(true);
      expect(unused?.actionableAt).toEqual(
        new Date(daysAgo(4).getTime() + 14 * DAY),
      );
    });

    test("low confidence when history is short", () => {
      const report = analyze({
        roles: [modRole],
        members: mods,
        observedSince: daysAgo(3),
      });

      expect(
        findingsOf(report, "unused_role_permission")[0]?.lowConfidence,
      ).toBe(true);
    });

    test("untracked permissions are never called unused", () => {
      const report = analyze({
        roles: [modRole],
        members: mods,
        observed: ["BanMembers"],
        lastUsed: { "1": { BanMembers: daysAgo(1) } },
      });

      expect(findingsOf(report, "unused_role_permission")).toEqual([]);
      expect(report.notTracked).toEqual([
        { roleId: "50", permissions: ["ManageWebhooks"] },
      ]);
    });

    test("may be used through bots when a bot used the permission", () => {
      const bot = member({ id: "77", isBot: true });
      const report = analyze({
        roles: [modRole],
        members: [...mods, bot],
        lastUsed: {
          "1": { ManageWebhooks: daysAgo(1) },
          "77": { BanMembers: daysAgo(2) },
        },
      });

      expect(findingsOf(report, "unused_role_permission")).toEqual([]);
      expect(
        findingsOf(report, "possibly_used_through_bots")[0]?.permissions,
      ).toEqual(["BanMembers"]);
    });

    test("a bot's message usage isn't evidence of acting for humans", () => {
      const bot = member({ id: "77", isBot: true });
      const report = analyze({
        roles: [modRole],
        members: [...mods, bot],
        lastUsed: {
          "1": { ManageWebhooks: daysAgo(1) },
          "77": { BanMembers: daysAgo(2) },
        },
        auditLogLastUsed: { "1": { ManageWebhooks: daysAgo(1) } },
      });

      expect(findingsOf(report, "possibly_used_through_bots")).toEqual([]);
      expect(
        findingsOf(report, "unused_role_permission")[0]?.permissions,
      ).toEqual(["BanMembers"]);
    });

    test("holders who were never resolved still make a permission unused", () => {
      const report = analyze({
        roles: [{ ...modRole, holderIds: [], holderCount: 3 }],
        lastUsed: {},
      });

      expect(findingsOf(report, "unused_role_permission")[0]).toMatchObject({
        permissions: ["ManageWebhooks", "BanMembers"],
        holderCount: 3,
      });
    });

    test("use by any resolved holder counts for the whole role", () => {
      const report = analyze({
        roles: [{ ...modRole, holderIds: ["1"], holderCount: 12 }],
        members: [member({ id: "1" })],
        lastUsed: { "1": { BanMembers: daysAgo(1) } },
      });

      expect(
        findingsOf(report, "unused_role_permission")[0]?.permissions,
      ).toEqual(["ManageWebhooks"]);
    });

    test("a role a bot holds gets no unused finding", () => {
      const report = analyze({
        roles: [{ ...modRole, holderIds: ["77"], holderCount: 4 }],
        members: [member({ id: "77", isBot: true })],
      });

      expect(findingsOf(report, "unused_role_permission")).toEqual([]);
    });

    test("an Administrator role a bot holds has no automatic fix", () => {
      const report = analyze({
        roles: [
          role({
            id: "61",
            position: 9,
            permissions: bits("Administrator"),
            holderIds: ["77"],
          }),
        ],
        members: [member({ id: "77", isBot: true })],
      });

      expect(findingsOf(report, "administrator_grant")[0]?.isBotRole).toBe(
        true,
      );
    });

    test("usage by unresolved users counts as used", () => {
      const report = analyze({
        roles: [{ ...modRole, holderIds: [], holderCount: 3 }],
        unresolved: ["BanMembers"],
      });

      expect(
        findingsOf(report, "unused_role_permission")[0]?.permissions,
      ).toEqual(["ManageWebhooks"]);
    });
  });

  test("administrator lists which dangerous permissions were used", () => {
    const report = analyze({
      roles: [
        role({
          id: "60",
          position: 9,
          permissions: bits("Administrator"),
          holderIds: ["1"],
        }),
      ],
      members: [member({ id: "1" })],
      lastUsed: { "1": { KickMembers: daysAgo(2), BanMembers: daysAgo(80) } },
    });

    const [admin] = findingsOf(report, "administrator_grant");
    expect(admin).toMatchObject({
      usedPermissions: ["KickMembers"],
      isBotRole: false,
    });
    expect(findingsOf(report, "unused_role_permission")).toEqual([]);
  });

  describe("Administrator with no holders", () => {
    const emptyAdmin = role({
      id: "61",
      position: 9,
      permissions: bits("Administrator"),
    });

    test("is low", () => {
      const report = analyze({ roles: [emptyAdmin] });

      expect(
        report.findings.find((f) => f.finding.type === "administrator_grant")
          ?.severity,
      ).toBe("low");
    });

    test("stays critical with holders none of whom were resolved", () => {
      const report = analyze({
        roles: [{ ...emptyAdmin, holderCount: 2 }],
      });

      expect(
        report.findings.find((f) => f.finding.type === "administrator_grant")
          ?.severity,
      ).toBe("critical");
    });
  });

  describe("Administrator confidence", () => {
    const adminRole = role({
      id: "60",
      position: 9,
      permissions: bits("Administrator"),
      holderIds: ["1"],
    });

    test("enough history is actionable", () => {
      const report = analyze({
        roles: [adminRole],
        members: [member({ id: "1" })],
      });

      expect(findingsOf(report, "administrator_grant")[0]).toMatchObject({
        lowConfidence: false,
        actionableAt: null,
      });
    });

    test("first run with history starting now is low confidence", () => {
      const report = analyze({
        roles: [adminRole],
        members: [member({ id: "1" })],
        observedSince: NOW,
      });

      expect(findingsOf(report, "administrator_grant")[0]).toMatchObject({
        lowConfidence: true,
        actionableAt: new Date(NOW.getTime() + 14 * DAY),
      });
    });

    test("no tracked permissions (no audit log) is never actionable", () => {
      const report = analyze({
        roles: [adminRole],
        members: [member({ id: "1" })],
        observed: [],
      });

      expect(findingsOf(report, "administrator_grant")[0]).toMatchObject({
        lowConfidence: true,
        actionableAt: null,
      });
    });

    test("a role newer than 14 days is low confidence", () => {
      const report = analyze({
        roles: [{ ...adminRole, createdAt: daysAgo(3) }],
        members: [member({ id: "1" })],
      });

      expect(findingsOf(report, "administrator_grant")[0]?.lowConfidence).toBe(
        true,
      );
    });
  });

  test("bot roles are summarised, admin is a finding, no unused findings", () => {
    const report = analyze({
      roles: [
        role({
          id: "70",
          position: 3,
          permissions: bits("Administrator"),
          botUserId: "77",
          holderIds: ["77"],
        }),
        role({
          id: "71",
          position: 2,
          permissions: bits("ManageMessages"),
          botUserId: "78",
          holderIds: ["78"],
        }),
      ],
      members: [
        member({ id: "77", isBot: true, joinedAt: daysAgo(10) }),
        member({ id: "78", isBot: true }),
      ],
    });

    expect(report.bots).toEqual([
      expect.objectContaining({ roleId: "70", addedRecently: true }),
      expect.objectContaining({ roleId: "71", addedRecently: false }),
    ]);
    expect(findingsOf(report, "administrator_grant")[0]?.isBotRole).toBe(true);
    expect(findingsOf(report, "unused_role_permission")).toEqual([]);
  });

  test("self-assignable dangerous roles are critical unless restricted", () => {
    const report = analyze({
      roles: [
        role({ id: "80", permissions: bits("ManageMessages") }),
        role({ id: "81", permissions: bits("KickMembers") }),
        role({ id: "82", permissions: bits("SendMessages") }),
      ],
      guild: {
        selfAssignable: [
          { roleId: "80", source: "role menu Pick roles", restricted: false },
          { roleId: "81", source: "role menu Staff", restricted: true },
          { roleId: "82", source: "level 5 reward", restricted: false },
        ],
      },
    });

    const rated = report.findings.filter(
      (f) => f.finding.type === "self_assignable_role",
    );
    expect(rated.map((f) => f.severity)).toEqual(["critical", "high"]);
  });

  test("Manage Roles can reach lower roles with more permissions", () => {
    const report = analyze({
      roles: [
        role({
          id: "90",
          position: 10,
          permissions: bits("ManageRoles"),
          holderIds: ["1"],
        }),
        role({ id: "91", position: 5, permissions: bits("BanMembers") }),
        role({ id: "92", position: 4, permissions: bits("ManageGuild") }),
        role({ id: "93", position: 20, permissions: bits("Administrator") }),
      ],
      members: [member({ id: "1" })],
      lastUsed: { "1": { ManageRoles: daysAgo(1) } },
    });

    const [escalation] = findingsOf(report, "escalation");
    expect(escalation).toMatchObject({
      roleId: "90",
      reachableRoleId: "92",
      gainedPermissions: ["ManageGuild"],
    });
  });

  test("channel overrides: dangerous allows and dead overrides", () => {
    const report = analyze({
      roles: [
        role({ id: "60", permissions: bits("Administrator") }),
        role({ id: "61" }),
      ],
      guild: {
        overwrites: [
          {
            channelId: "c1",
            channelName: "general",
            targetId: "61",
            targetType: "role",
            allow: bits("ManageWebhooks", "SendMessages"),
            deny: 0n,
          },
          {
            channelId: "c2",
            channelName: "mod-chat",
            targetId: "60",
            targetType: "role",
            allow: bits("SendMessages"),
            deny: 0n,
          },
          {
            channelId: "c3",
            channelName: "art",
            targetId: "61",
            targetType: "role",
            allow: bits("AttachFiles"),
            deny: 0n,
          },
        ],
      },
    });

    expect(findingsOf(report, "dangerous_overwrite")[0]?.permissions).toEqual([
      "ManageWebhooks",
    ]);
    expect(findingsOf(report, "dead_overwrite")[0]?.channelId).toBe("c2");
    expect(report.findings.filter((f) => f.tab === "channels")).toHaveLength(2);
  });

  test("2FA finding when not required and humans hold gated permissions", () => {
    const report = analyze({
      roles: [
        role({ id: "50", permissions: bits("BanMembers"), holderIds: ["1"] }),
        role({
          id: "51",
          permissions: bits("ModerateMembers"),
          holderIds: ["1"],
        }),
      ],
      members: [member({ id: "1" })],
      guild: { mfaRequired: false },
    });

    expect(findingsOf(report, "mfa_disabled")[0]?.roleIds).toEqual(["50"]);
  });

  test("findings are sorted most severe first", () => {
    const report = analyze({
      roles: [
        role({
          id: "50",
          permissions: bits("ManageMessages"),
          holderIds: ["1"],
        }),
        role({
          id: "51",
          permissions: bits("ManageWebhooks"),
          holderIds: ["1"],
        }),
      ],
      members: [member({ id: "1" })],
    });

    expect(report.findings.map((f) => f.severity)).toEqual([
      "critical",
      "medium",
    ]);
  });
});
