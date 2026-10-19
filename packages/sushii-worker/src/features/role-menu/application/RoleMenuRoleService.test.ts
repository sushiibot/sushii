import { describe, expect, mock, test } from "bun:test";
import type { Guild } from "discord.js";
import { PermissionFlagsBits } from "discord.js";
import pino from "pino";
import { None, Some } from "ts-results";

import type { RoleMenuRepository } from "../domain/repositories/RoleMenuRepository";
import { RoleMenuRoleService } from "./RoleMenuRoleService";

const logger = pino({ level: "silent" });

function createGuild(opts: {
  botPermissions: bigint[];
  botHighestPosition: number;
  rolePositions: Record<string, number>;
}): Guild {
  const roles = new Map(
    Object.entries(opts.rolePositions).map(([id, position]) => [
      id,
      { id, position },
    ]),
  );

  return {
    id: "guild",
    members: {
      me: {
        permissions: {
          // Mirrors discord.js: Administrator implies every permission
          has: (perm: bigint) =>
            opts.botPermissions.includes(PermissionFlagsBits.Administrator) ||
            opts.botPermissions.includes(perm),
        },
        roles: { highest: { position: opts.botHighestPosition } },
      },
    },
    roles: { cache: roles },
  } as unknown as Guild;
}

function createRepository(): RoleMenuRepository {
  return {
    findByName: mock(async () =>
      Some({ id: 1, guildId: "guild", menuName: "menu" }),
    ),
    setRoles: mock(() => Promise.resolve()),
  } as unknown as RoleMenuRepository;
}

describe("RoleMenuRoleService.validateBotPermissions", () => {
  test("reports roles at or above the bot even when the bot has Administrator", () => {
    const service = new RoleMenuRoleService(createRepository(), logger);
    const guild = createGuild({
      botPermissions: [PermissionFlagsBits.Administrator],
      botHighestPosition: 5,
      rolePositions: { low: 1, equal: 5, high: 10 },
    });

    const result = service.validateBotPermissions(guild, [
      "low",
      "equal",
      "high",
    ]);

    expect(result.canManageRoles).toBe(true);
    expect(result.roleIdsHigherThanBot).toEqual(["equal", "high"]);
  });

  test("reports missing Manage Roles permission", () => {
    const service = new RoleMenuRoleService(createRepository(), logger);
    const guild = createGuild({
      botPermissions: [],
      botHighestPosition: 5,
      rolePositions: { low: 1 },
    });

    const result = service.validateBotPermissions(guild, ["low"]);

    expect(result.canManageRoles).toBe(false);
  });
});

describe("RoleMenuRoleService.setRoles", () => {
  const guild = createGuild({
    botPermissions: [PermissionFlagsBits.ManageRoles],
    botHighestPosition: 20,
    rolePositions: { low: 1, equal: 5, high: 10 },
  });

  test("rejects a role at the same position as the user's highest role", async () => {
    const repo = createRepository();
    const service = new RoleMenuRoleService(repo, logger);

    const result = await service.setRoles("guild", "menu", ["equal"], guild, 5);

    expect(result.err).toBe(true);
    expect(repo.setRoles).not.toHaveBeenCalled();
  });

  test("rejects a role above the user's highest role", async () => {
    const service = new RoleMenuRoleService(createRepository(), logger);

    const result = await service.setRoles("guild", "menu", ["high"], guild, 5);

    expect(result.err).toBe(true);
  });

  test("allows roles below the user's highest role", async () => {
    const repo = createRepository();
    const service = new RoleMenuRoleService(repo, logger);

    const result = await service.setRoles("guild", "menu", ["low"], guild, 5);

    expect(result.ok).toBe(true);
    expect(repo.setRoles).toHaveBeenCalledWith("guild", "menu", ["low"]);
  });

  test("skips the user hierarchy check when no user position is given", async () => {
    const service = new RoleMenuRoleService(createRepository(), logger);

    const result = await service.setRoles(
      "guild",
      "menu",
      ["high"],
      guild,
      undefined,
    );

    expect(result.ok).toBe(true);
  });

  test("errors when the menu does not exist", async () => {
    const repo = createRepository();
    repo.findByName = mock(async () => None);
    const service = new RoleMenuRoleService(repo, logger);

    const result = await service.setRoles("guild", "menu", ["low"], guild, 5);

    expect(result.err).toBe(true);
  });
});
