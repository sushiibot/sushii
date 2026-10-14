import { describe, expect, test } from "bun:test";
import { PermissionFlagsBits } from "discord.js";

import { type ChangeActor, authorizeChange } from "./authorizeChange";
import type { PlannedChange } from "./planChange";

const P = PermissionFlagsBits;

const REMOVE: PlannedChange = {
  kind: "set_role_permissions",
  roleId: "50",
  before: P.BanMembers | P.ManageWebhooks,
  after: P.BanMembers,
  affectedMembers: 3,
  channelLosses: [],
};

const GRANT: PlannedChange = {
  kind: "set_role_permissions",
  roleId: "60",
  before: P.Administrator,
  after: P.KickMembers | P.ViewChannel,
  affectedMembers: 2,
  channelLosses: [],
};

const OVERRIDE: PlannedChange = {
  kind: "edit_overwrite",
  channelId: "c1",
  targetId: "50",
  targetType: "role",
  beforeAllow: P.ManageWebhooks,
  afterAllow: 0n,
};

const TARGET = { rolePosition: 5, roleName: "@Mod" };

function actor(overrides: Partial<ChangeActor> = {}): ChangeActor {
  return {
    name: "You",
    isOwner: false,
    permissions: P.ManageRoles,
    channelPermissions: null,
    highestRolePosition: 10,
    ...overrides,
  };
}

const SUSHII = actor({
  name: "sushii",
  permissions: P.ManageRoles | P.BanMembers | P.KickMembers | P.ViewChannel,
});

function check(change: PlannedChange, runner: ChangeActor, bot = SUSHII) {
  return authorizeChange(change, TARGET, [runner, bot]);
}

describe("authorizeChange", () => {
  test("removal needs only Manage Roles and hierarchy", () => {
    expect(check(REMOVE, actor()).ok).toBe(true);
  });

  test("runner without Manage Roles is refused", () => {
    const result = check(REMOVE, actor({ permissions: P.ManageGuild }));

    expect(result.err && result.val).toBe("You need Manage Roles.");
  });

  test("Administrator implies Manage Roles", () => {
    expect(check(REMOVE, actor({ permissions: P.Administrator })).ok).toBe(
      true,
    );
  });

  test("role at or above the runner is refused", () => {
    const result = check(REMOVE, actor({ highestRolePosition: 5 }));

    expect(result.err && result.val).toBe(
      "@Mod isn't below your highest role.",
    );
  });

  test("the owner bypasses hierarchy", () => {
    expect(
      check(
        REMOVE,
        actor({ isOwner: true, permissions: 0n, highestRolePosition: 0 }),
      ).ok,
    ).toBe(true);
  });

  test("sushii below the role is refused even when the runner can", () => {
    const result = check(REMOVE, actor(), {
      ...SUSHII,
      highestRolePosition: 4,
    });

    expect(result.err && result.val).toBe(
      "@Mod isn't below sushii's highest role.",
    );
  });

  test("granting needs the runner to hold every added permission", () => {
    const result = check(
      GRANT,
      actor({ permissions: P.ManageRoles | P.ViewChannel }),
    );

    expect(result.err && result.val).toContain("You need every permission");
  });

  test("granting is allowed when the runner holds them", () => {
    expect(
      check(
        GRANT,
        actor({ permissions: P.ManageRoles | P.KickMembers | P.ViewChannel }),
      ).ok,
    ).toBe(true);
  });

  test("sushii must hold granted permissions too", () => {
    const result = check(
      GRANT,
      actor({ permissions: P.ManageRoles | P.KickMembers | P.ViewChannel }),
      { ...SUSHII, permissions: P.ManageRoles },
    );

    expect(result.err && result.val).toContain("sushii needs every permission");
  });

  test("override edits need Manage Permissions in that channel", () => {
    const refused = check(OVERRIDE, actor({ channelPermissions: 0n }));
    const allowed = check(
      OVERRIDE,
      actor({ permissions: 0n, channelPermissions: P.ManageRoles }),
      { ...SUSHII, channelPermissions: P.ManageRoles },
    );

    expect(refused.err && refused.val).toBe(
      "You need Manage Permissions in <#c1>.",
    );
    expect(allowed.ok).toBe(true);
  });
});
