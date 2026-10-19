import { describe, expect, test } from "bun:test";
import type { Guild, StringSelectMenuBuilder } from "discord.js";

import type { RoleMenu } from "../../domain/entities/RoleMenu";
import type { RoleMenuRole } from "../../domain/entities/RoleMenuRole";
import { createRoleMenuMessage } from "./RoleMenuView";

const guild = { roles: { cache: new Map() } } as unknown as Guild;

function roles(count: number): RoleMenuRole[] {
  return Array.from({ length: count }, (_, i) => ({
    guildId: "guild",
    menuName: "menu",
    roleId: `${i + 1}`,
    position: i,
  })) as RoleMenuRole[];
}

function selectMenuData(maxCount: number | undefined, roleCount: number) {
  const menu: RoleMenu = {
    id: 1,
    guildId: "guild",
    menuName: "menu",
    maxCount,
  };

  const { components } = createRoleMenuMessage({
    menu,
    roles: roles(roleCount),
    guild,
    type: "select_menu",
  });

  const select = components[0].components[0] as StringSelectMenuBuilder;
  return select.toJSON();
}

describe("createRoleMenuMessage select menu bounds", () => {
  test("clamps max values to the number of roles", () => {
    const data = selectMenuData(10, 3);

    expect(data.max_values).toBe(3);
    expect(data.min_values).toBe(0);
  });

  test("uses max count when lower than the number of roles", () => {
    const data = selectMenuData(2, 5);

    expect(data.max_values).toBe(2);
  });

  test("defaults max values to the number of roles", () => {
    const data = selectMenuData(undefined, 4);

    expect(data.max_values).toBe(4);
  });
});
