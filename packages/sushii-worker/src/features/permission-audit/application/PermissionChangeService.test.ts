import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  Collection,
  type Guild,
  type GuildMember,
  PermissionFlagsBits,
} from "discord.js";
import pino from "pino";

import type { PlannedChange } from "../domain/planChange";
import { PermissionChangeService } from "./PermissionChangeService";

const P = PermissionFlagsBits;
const GUILD_ID = "1000";

function member(id: string, permissions: bigint, highest: number) {
  return {
    id,
    user: { username: id === "runner" ? "drk" : "sushii" },
    permissions: { bitfield: permissions },
    roles: { highest: { position: highest } },
  } as unknown as GuildMember;
}

describe("PermissionChangeService", () => {
  let role: {
    id: string;
    name: string;
    position: number;
    permissions: { bitfield: bigint };
    setPermissions: ReturnType<typeof mock>;
  };
  let overwrite: {
    allow: { bitfield: bigint };
    deny: { bitfield: bigint };
    edit: ReturnType<typeof mock>;
    delete: ReturnType<typeof mock>;
  };
  let rolesCreate: ReturnType<typeof mock>;
  let setPositions: ReturnType<typeof mock>;
  let roleCount: number;
  let guild: Guild;
  let runner: GuildMember;
  const service = new PermissionChangeService(pino({ level: "silent" }));

  beforeEach(() => {
    role = {
      id: "50",
      name: "Mod",
      position: 5,
      permissions: { bitfield: P.BanMembers | P.ManageWebhooks },
      setPermissions: mock(() => Promise.resolve()),
    };
    overwrite = {
      allow: { bitfield: P.ManageWebhooks | P.AttachFiles },
      deny: { bitfield: 0n },
      edit: mock(() => Promise.resolve()),
      delete: mock(() => Promise.resolve()),
    };
    rolesCreate = mock(() => Promise.resolve({ id: "99" }));
    setPositions = mock(() => Promise.resolve());
    roleCount = 10;
    const all = P.ManageRoles | P.BanMembers | P.ManageWebhooks;
    runner = member("runner", all, 10);

    const roles = new Collection([["50", role]]);
    guild = {
      id: GUILD_ID,
      ownerId: "owner",
      members: { me: member("sushii", all, 9) },
      roles: {
        cache: {
          get: (id: string) => roles.get(id),
          get size() {
            return roleCount;
          },
        },
        create: rolesCreate,
        setPositions,
      },
      channels: {
        cache: new Collection([
          [
            "c1",
            {
              permissionOverwrites: {
                cache: new Collection([["50", overwrite]]),
              },
              permissionsFor: () => ({ bitfield: P.ManageRoles }),
            },
          ],
        ]),
      },
    } as unknown as Guild;
  });

  const removeWebhooks: PlannedChange = {
    kind: "set_role_permissions",
    roleId: "50",
    before: P.BanMembers | P.ManageWebhooks,
    after: P.BanMembers,
    affectedMembers: 2,
    channelLosses: [],
  };

  test("sets exactly the planned bitfield with an audit log reason", async () => {
    const result = await service.apply(guild, runner, removeWebhooks);

    expect(result.ok).toBe(true);
    expect(role.setPermissions).toHaveBeenCalledWith(
      P.BanMembers,
      "Permission audit by drk",
    );
  });

  test("refuses when the role changed since the report", async () => {
    role.permissions.bitfield = P.BanMembers;

    const result = await service.apply(guild, runner, removeWebhooks);

    expect(result.err && result.val).toContain("changed after the report");
    expect(role.setPermissions).not.toHaveBeenCalled();
  });

  test("refuses without making a call when the runner lacks permission", async () => {
    const result = await service.apply(
      guild,
      member("runner", P.ManageGuild, 10),
      removeWebhooks,
    );

    expect(result.err && result.val).toBe("You need Manage Roles.");
    expect(role.setPermissions).not.toHaveBeenCalled();
  });

  test("override edit resets only the removed flags", async () => {
    const result = await service.apply(guild, runner, {
      kind: "edit_overwrite",
      channelId: "c1",
      targetId: "50",
      targetType: "role",
      beforeAllow: P.ManageWebhooks | P.AttachFiles,
      afterAllow: P.AttachFiles,
    });

    expect(result.ok).toBe(true);
    expect(overwrite.edit).toHaveBeenCalledWith(
      { ManageWebhooks: null },
      "Permission audit by drk",
    );
    expect(overwrite.delete).not.toHaveBeenCalled();
  });

  test("override delete only when allow and deny are unchanged", async () => {
    const change: PlannedChange = {
      kind: "delete_overwrite",
      channelId: "c1",
      targetId: "50",
      beforeAllow: P.ManageWebhooks | P.AttachFiles,
      beforeDeny: 0n,
    };

    overwrite.deny.bitfield = P.SendMessages;
    const refused = await service.apply(guild, runner, change);
    expect(refused.err).toBe(true);
    expect(overwrite.delete).not.toHaveBeenCalled();

    overwrite.deny.bitfield = 0n;
    const applied = await service.apply(guild, runner, change);
    expect(applied.ok).toBe(true);
    expect(overwrite.delete).toHaveBeenCalledWith("Permission audit by drk");
  });

  const split: PlannedChange = {
    kind: "create_role",
    sourceRoleId: "50",
    name: "Mod · Ban Members",
    permissions: P.BanMembers,
    assignToIds: ["1"],
  };

  test("split creates the role, then moves only it below the source", async () => {
    const result = await service.apply(guild, runner, split);

    expect(result.ok && result.val).toEqual({});
    expect(rolesCreate).toHaveBeenCalledWith({
      name: "Mod · Ban Members",
      permissions: P.BanMembers,
      reason: "Permission audit by drk",
    });
    expect(setPositions).toHaveBeenCalledWith([{ role: "99", position: 5 }]);
  });

  test("a failed move still reports the created role with a warning", async () => {
    setPositions.mockImplementation(() =>
      Promise.reject(new Error("Missing Permissions")),
    );

    const result = await service.apply(guild, runner, split);

    expect(result.ok && result.val.warning).toContain(
      "bottom of the role list",
    );
  });

  test("split refuses at the role limit", async () => {
    roleCount = 250;

    const result = await service.apply(guild, runner, split);

    expect(result.err && result.val).toContain("250 roles");
    expect(rolesCreate).not.toHaveBeenCalled();
  });

  test("Discord errors are thrown to the caller", async () => {
    role.setPermissions.mockImplementation(() =>
      Promise.reject(new Error("Missing Permissions")),
    );

    await expect(service.apply(guild, runner, removeWebhooks)).rejects.toThrow(
      "Missing Permissions",
    );
  });
});
