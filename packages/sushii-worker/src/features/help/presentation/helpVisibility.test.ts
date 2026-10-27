import { describe, expect, test } from "bun:test";
import type { RESTPostAPIApplicationCommandsJSONBody } from "discord.js";
import { PermissionFlagsBits, PermissionsBitField } from "discord.js";

import type { HelpCategory } from "../domain/helpCatalog";
import { canRun, resolveVisibleHelp } from "./helpVisibility";

const CATEGORIES: HelpCategory[] = [
  {
    key: "a",
    audience: "members",
    name: "A",
    emoji: "note",
    commands: [
      { name: "open", summary: "" },
      { name: "unregistered", summary: "" },
    ],
    apps: ["Open App", "Missing App"],
  },
  {
    key: "b",
    audience: "admins",
    name: "B",
    emoji: "gear",
    commands: [{ name: "admin-only", summary: "" }],
  },
];

const COMMANDS = [
  { name: "open", description: "" },
  { name: "Open App", type: 2 },
  { name: "admin-only", description: "", default_member_permissions: "0" },
] as RESTPostAPIApplicationCommandsJSONBody[];

function names(perms: PermissionsBitField | null) {
  const visible = resolveVisibleHelp(COMMANDS, perms, CATEGORIES);
  return {
    audiences: visible.audiences,
    commands: visible.categories.flatMap((v) => v.commands.map((c) => c.name)),
    apps: visible.categories.flatMap((v) => v.apps),
  };
}

describe("resolveVisibleHelp", () => {
  test("hides unregistered commands and apps", () => {
    expect(names(new PermissionsBitField())).toEqual({
      audiences: ["members"],
      commands: ["open"],
      apps: ["Open App"],
    });
  });

  test('"0" permissions are admin-only', () => {
    expect(
      names(new PermissionsBitField(PermissionFlagsBits.ManageGuild)).commands,
    ).toEqual(["open"]);
    expect(
      names(new PermissionsBitField(PermissionFlagsBits.Administrator)),
    ).toMatchObject({
      audiences: ["members", "admins"],
      commands: ["open", "admin-only"],
    });
  });

  test("no member permissions only shows unrestricted commands", () => {
    expect(names(null).commands).toEqual(["open"]);
  });
});

describe("canRun", () => {
  const banAndKick = (
    PermissionFlagsBits.BanMembers | PermissionFlagsBits.KickMembers
  ).toString();

  test("needs every bit of a multi-permission command", () => {
    expect(
      canRun(
        banAndKick,
        new PermissionsBitField(PermissionFlagsBits.BanMembers),
      ),
    ).toBe(false);
  });

  test("Administrator can run any command", () => {
    expect(
      canRun(
        banAndKick,
        new PermissionsBitField(PermissionFlagsBits.Administrator),
      ),
    ).toBe(true);
  });
});
