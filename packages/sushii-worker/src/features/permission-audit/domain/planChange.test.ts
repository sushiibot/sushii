import { describe, expect, test } from "bun:test";
import { PermissionFlagsBits } from "discord.js";

import type { Finding } from "./Finding";
import type { GuildSnapshot, RoleSnapshot } from "./GuildSnapshot";
import type { PermissionName } from "./PermissionUsage";
import { DANGEROUS_PERMISSIONS } from "./permissionCatalog";
import {
  NON_DANGEROUS_PERMISSIONS,
  type PlannedChange,
  permissionDiff,
  planChange,
} from "./planChange";

const EVERYONE = "1000";

function bits(...permissions: PermissionName[]): bigint {
  return permissions.reduce((acc, p) => acc | PermissionFlagsBits[p], 0n);
}

function role(id: string, overrides: Partial<RoleSnapshot> = {}): RoleSnapshot {
  return {
    id,
    name: `role-${id}`,
    position: 5,
    permissions: 0n,
    botUserId: null,
    createdAt: new Date(0),
    holderIds: ["1", "2"],
    holderCount: 2,
    ...overrides,
  };
}

const GUILD: GuildSnapshot = {
  guildId: EVERYONE,
  ownerId: "9",
  everyoneRoleId: EVERYONE,
  mfaRequired: true,
  roles: [
    role(EVERYONE, {
      position: 0,
      permissions: bits("SendMessages", "MentionEveryone"),
      holderIds: [],
    }),
    role("50", {
      name: "Mod",
      permissions: bits("BanMembers", "ManageWebhooks", "SendMessages"),
    }),
    role("60", { name: "Staff", permissions: bits("Administrator") }),
  ],
  overwrites: [
    {
      channelId: "c1",
      channelName: "general",
      targetId: "50",
      targetType: "role",
      allow: bits("ManageWebhooks", "AttachFiles"),
      deny: 0n,
    },
    {
      channelId: "c2",
      channelName: "mod-logs",
      targetId: EVERYONE,
      targetType: "role",
      allow: 0n,
      deny: bits("ViewChannel"),
    },
    {
      channelId: "c3",
      channelName: "owner-chat",
      targetId: EVERYONE,
      targetType: "role",
      allow: 0n,
      deny: bits("ViewChannel"),
    },
    {
      channelId: "c3",
      channelName: "owner-chat",
      targetId: "60",
      targetType: "role",
      allow: bits("ViewChannel"),
      deny: bits("SendMessages"),
    },
  ],
  members: new Map([
    [
      "1",
      {
        id: "1",
        username: "a",
        isBot: false,
        roleIds: [],
        joinedAt: null,
      },
    ],
    [
      "2",
      {
        id: "2",
        username: "b",
        isBot: false,
        roleIds: [],
        joinedAt: null,
      },
    ],
    [
      "3",
      {
        id: "3",
        username: "c",
        isBot: false,
        roleIds: [],
        joinedAt: null,
      },
    ],
  ]),
  memberCount: 3,
  selfAssignable: [],
  now: new Date(),
};

const EVERY_FINDING: Finding[] = [
  {
    type: "everyone_dangerous",
    roleId: EVERYONE,
    permissions: ["MentionEveryone"],
  },
  {
    type: "administrator_grant",
    roleId: "60",
    holderCount: 2,
    usedPermissions: ["KickMembers"],
    isBotRole: false,
    lowConfidence: false,
    actionableAt: null,
  },
  {
    type: "administrator_grant",
    roleId: "60",
    holderCount: 2,
    usedPermissions: [],
    isBotRole: true,
    lowConfidence: false,
    actionableAt: null,
  },
  {
    type: "unused_role_permission",
    roleId: "50",
    permissions: ["ManageWebhooks"],
    holderCount: 2,
    lowConfidence: false,
    actionableAt: null,
  },
  {
    type: "unused_role_permission",
    roleId: "50",
    permissions: ["ManageWebhooks"],
    holderCount: 2,
    lowConfidence: true,
    actionableAt: new Date(),
  },
  {
    type: "possibly_used_through_bots",
    roleId: "50",
    permissions: ["BanMembers"],
  },
  {
    type: "self_assignable_role",
    roleId: "50",
    permissions: ["BanMembers"],
    source: "role menu x",
    restricted: false,
  },
  {
    type: "escalation",
    roleId: "50",
    reachableRoleId: "60",
    gainedPermissions: ["ManageGuild"],
  },
  { type: "mfa_disabled", roleIds: ["50"] },
  {
    type: "dangerous_overwrite",
    channelId: "c1",
    channelName: "general",
    targetId: "50",
    targetType: "role",
    permissions: ["ManageWebhooks"],
  },
  {
    type: "dead_overwrite",
    channelId: "c3",
    channelName: "owner-chat",
    targetId: "60",
  },
];

describe("planChange", () => {
  test("removing from @everyone affects every member", () => {
    const change = planChange(EVERY_FINDING[0] as Finding, GUILD);

    expect(change).toMatchObject({
      kind: "set_role_permissions",
      roleId: EVERYONE,
      affectedMembers: 3,
    });
    if (change?.kind === "set_role_permissions") {
      expect(permissionDiff(change.before, change.after)).toEqual({
        removed: ["MentionEveryone"],
        added: [],
      });
    }
  });

  test("unused permissions are removed and nothing else changes", () => {
    const change = planChange(EVERY_FINDING[3] as Finding, GUILD);

    expect(change?.kind).toBe("set_role_permissions");
    if (change?.kind === "set_role_permissions") {
      expect(change.after).toBe(bits("BanMembers", "SendMessages"));
    }
  });

  test("low confidence findings have no automatic fix", () => {
    expect(planChange(EVERY_FINDING[4] as Finding, GUILD)).toBeNull();
  });

  test("Administrator is replaced with used plus pinned non-dangerous permissions", () => {
    const change = planChange(EVERY_FINDING[1] as Finding, GUILD);

    expect(change?.kind).toBe("set_role_permissions");
    if (change?.kind !== "set_role_permissions") {
      return;
    }
    const { removed, added } = permissionDiff(change.before, change.after);
    expect(removed).toEqual(["Administrator"]);
    expect(added).toContain("KickMembers");
    expect(added).toContain("ViewChannel");
    for (const dangerous of DANGEROUS_PERMISSIONS) {
      if (dangerous !== "KickMembers") {
        expect(added).not.toContain(dangerous);
      }
    }
  });

  test("Administrator replacement lists channels whose overrides now apply", () => {
    const change = planChange(EVERY_FINDING[1] as Finding, GUILD);

    if (change?.kind !== "set_role_permissions") {
      throw new Error("expected a role change");
    }
    expect(change.channelLosses).toEqual([
      { channelId: "c2", permissions: ["ViewChannel"] },
      { channelId: "c3", permissions: ["SendMessages"] },
    ]);
  });

  test("low confidence Administrator has no automatic fix", () => {
    const finding = {
      ...(EVERY_FINDING[1] as Extract<
        Finding,
        { type: "administrator_grant" }
      >),
      lowConfidence: true,
    };

    expect(planChange(finding, GUILD)).toBeNull();
  });

  test("bot Administrator is manual", () => {
    expect(planChange(EVERY_FINDING[2] as Finding, GUILD)).toBeNull();
  });

  test("override fix removes only the dangerous allow", () => {
    const change = planChange(EVERY_FINDING[9] as Finding, GUILD);

    expect(change).toEqual({
      kind: "edit_overwrite",
      channelId: "c1",
      targetId: "50",
      targetType: "role",
      beforeAllow: bits("ManageWebhooks", "AttachFiles"),
      afterAllow: bits("AttachFiles"),
    });
  });

  test("findings on missing roles or overrides have no fix", () => {
    const empty = { ...GUILD, roles: [], overwrites: [] };

    for (const finding of EVERY_FINDING) {
      expect(planChange(finding, empty)).toBeNull();
    }
  });

  test("only a dead override can be deleted, and nothing deletes a role", () => {
    const deletes = EVERY_FINDING.map((finding) => ({
      type: finding.type,
      change: planChange(finding, GUILD),
    })).filter(
      ({ change }) =>
        change !== null &&
        (change.kind === "delete_overwrite" ||
          (change.kind as string).includes("delete")),
    );

    expect(deletes.map((d) => d.type)).toEqual(["dead_overwrite"]);
  });

  test("every change kind is covered by this allowlist", () => {
    const kinds = new Set<PlannedChange["kind"]>(
      EVERY_FINDING.map((f) => planChange(f, GUILD)?.kind).filter(
        (kind): kind is PlannedChange["kind"] => kind !== undefined,
      ),
    );

    expect([...kinds].sort()).toEqual([
      "delete_overwrite",
      "edit_overwrite",
      "set_role_permissions",
    ]);
  });

  test("pinned non-dangerous list has no dangerous permissions", () => {
    for (const permission of NON_DANGEROUS_PERMISSIONS) {
      expect(DANGEROUS_PERMISSIONS).not.toContain(permission);
    }
  });
});
