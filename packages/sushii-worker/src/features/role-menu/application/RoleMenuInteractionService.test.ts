import { describe, expect, mock, test } from "bun:test";
import type { GuildMember } from "discord.js";
import pino from "pino";

import { RoleMenuInteractionService } from "./RoleMenuInteractionService";

const logger = pino({ level: "silent" });

function createMember(currentRoleIds: string[]) {
  const add = mock((_roleId: string) => Promise.resolve());
  const remove = mock((_roleId: string) => Promise.resolve());
  const set = mock((_roleIds: string[]) => Promise.resolve());

  const member = {
    id: "user",
    guild: { id: "guild" },
    roles: {
      cache: new Map(currentRoleIds.map((id) => [id, { id }])),
      add,
      remove,
      set,
    },
  } as unknown as GuildMember;

  return { member, add, remove, set };
}

const menuRoles = ["a", "b", "c"].map((roleId) => ({ roleId, label: roleId }));

describe("RoleMenuInteractionService.handleSelectMenuInteraction", () => {
  test("applies a diff with single-role add/remove instead of set", async () => {
    const service = new RoleMenuInteractionService(logger);
    const { member, add, remove, set } = createMember(["a", "other"]);

    const result = await service.handleSelectMenuInteraction(
      member,
      ["b"],
      menuRoles,
    );

    expect(result.ok).toBe(true);
    expect(set).not.toHaveBeenCalled();
    expect(add.mock.calls).toEqual([["b"]]);
    expect(remove.mock.calls).toEqual([["a"]]);
    expect(result.unwrap().addedRoles).toEqual(["b"]);
    expect(result.unwrap().removedRoles).toEqual(["a"]);
  });

  test("does not call the API when nothing changed", async () => {
    const service = new RoleMenuInteractionService(logger);
    const { member, add, remove } = createMember(["a"]);

    const result = await service.handleSelectMenuInteraction(
      member,
      ["a"],
      menuRoles,
    );

    expect(result.ok).toBe(true);
    expect(add).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  test("rejects selected roles that are no longer in the menu", async () => {
    const service = new RoleMenuInteractionService(logger);
    const { member, add, remove } = createMember([]);

    const result = await service.handleSelectMenuInteraction(
      member,
      ["a", "removed"],
      menuRoles,
    );

    expect(result.err).toBe(true);
    expect(result.val).toContain("<@&removed>");
    expect(add).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  test("enforces the required role", async () => {
    const service = new RoleMenuInteractionService(logger);
    const { member, add } = createMember([]);

    const result = await service.handleSelectMenuInteraction(
      member,
      ["a"],
      menuRoles,
      "required",
    );

    expect(result.err).toBe(true);
    expect(add).not.toHaveBeenCalled();
  });

  test("enforces max roles", async () => {
    const service = new RoleMenuInteractionService(logger);
    const { member, add } = createMember([]);

    const result = await service.handleSelectMenuInteraction(
      member,
      ["a", "b", "c"],
      menuRoles,
      undefined,
      2,
    );

    expect(result.err).toBe(true);
    expect(add).not.toHaveBeenCalled();
  });

  test("allows selecting up to max roles", async () => {
    const service = new RoleMenuInteractionService(logger);
    const { member, add } = createMember([]);

    const result = await service.handleSelectMenuInteraction(
      member,
      ["a", "b"],
      menuRoles,
      undefined,
      2,
    );

    expect(result.ok).toBe(true);
    expect(add.mock.calls).toEqual([["a"], ["b"]]);
  });
});

describe("RoleMenuInteractionService.handleButtonInteraction", () => {
  test("rejects a role that is no longer in the menu", async () => {
    const service = new RoleMenuInteractionService(logger);
    const { member, add, remove } = createMember([]);

    const result = await service.handleButtonInteraction(
      member,
      "removed",
      menuRoles,
    );

    expect(result.err).toBe(true);
    expect(add).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  test("adds a role in the menu", async () => {
    const service = new RoleMenuInteractionService(logger);
    const { member, add } = createMember([]);

    const result = await service.handleButtonInteraction(
      member,
      "a",
      menuRoles,
    );

    expect(result.ok).toBe(true);
    expect(add.mock.calls).toEqual([["a"]]);
  });

  test("removes a role the member already has", async () => {
    const service = new RoleMenuInteractionService(logger);
    const { member, remove } = createMember(["a"]);

    const result = await service.handleButtonInteraction(
      member,
      "a",
      menuRoles,
    );

    expect(result.ok).toBe(true);
    expect(remove.mock.calls).toEqual([["a"]]);
  });
});
