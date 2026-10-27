import { describe, expect, test } from "bun:test";

import { searchCommandList } from "@/test/fixtures/help";

import {
  APP_DESCRIPTION,
  buildHelpIndex,
  findExactEntry,
  rankHelpEntries,
} from "./helpIndex";

const entries = buildHelpIndex(searchCommandList());
const paths = (list: { path: string }[]) => list.map((e) => e.path);

function entry(path: string) {
  const found = entries.find((e) => e.path === path);
  if (!found) {
    throw new Error(`missing ${path}`);
  }
  return found;
}

describe("buildHelpIndex", () => {
  test("includes subcommands and subcommands inside groups, root first", () => {
    const all = paths(entries);

    expect(all).toContain("rolemenu create");
    expect(all).toContain("xp block channel");
    expect(all).not.toContain("xp block");
    expect(all.indexOf("rolemenu")).toBeLessThan(
      all.indexOf("rolemenu create"),
    );
  });

  test("excludes hidden commands", () => {
    expect(paths(entries)).not.toContain("help");
  });

  test("includes apps with their target", () => {
    expect(entry("User Info")).toMatchObject({
      kind: "app",
      appTarget: "user",
      description: APP_DESCRIPTION,
    });
    expect(entry("Submit to Mods")).toMatchObject({ appTarget: "message" });
    expect(entry("User Info")).not.toHaveProperty("catalog");
  });

  test("subcommands inherit keywords, category and permissions from the root", () => {
    const create = entry("rolemenu create");

    expect(create.keywords).toEqual(["self roles", "reaction roles"]);
    expect(create.audience).toBe("admins");
    expect(create.defaultMemberPermissions).toBe(
      entry("rolemenu").defaultMemberPermissions,
    );
    expect(create).toMatchObject({ kind: "slash", catalog: null });
    expect(entry("rolemenu")).toMatchObject({ catalog: { name: "rolemenu" } });
  });

  test("puts roots missing from the catalog last", () => {
    expect(entries.at(-1)?.path).toBe("mystery");
    expect(entry("mystery").audience).toBeNull();
  });
});

describe("rankHelpEntries", () => {
  test("ranks path prefix, then word prefix, ties in catalog order", () => {
    expect(paths(rankHelpEntries(entries, "leaderboard"))).toEqual([
      "leaderboard",
      "leaderboard-privacy",
      "fishy-leaderboard",
      "rep-leaderboard",
      "global-leaderboard",
    ]);
  });

  test("puts description and keyword matches last", () => {
    expect(paths(rankHelpEntries(entries, " ROLE "))).toEqual([
      "rolemenu",
      "rolemenu create",
      "rolemenu edit",
      "rolemenu send",
      "xp block role",
      "levelrole",
    ]);
  });

  test("matches catalog keywords", () => {
    expect(paths(rankHelpEntries(entries, "purge"))).toEqual(["prune"]);
    expect(paths(rankHelpEntries(entries, "mute"))).toEqual(["timeout"]);
  });

  test("matches subcommand words", () => {
    expect(paths(rankHelpEntries(entries, "channel"))).toEqual([
      "xp block channel",
      "rolemenu send",
    ]);
  });
});

describe("rankHelpEntries tiers", () => {
  test("exact path, then prefix, then substrings of 3+ characters", () => {
    expect(paths(rankHelpEntries(entries, "ban"))).toEqual([
      "ban",
      "banner",
      "tempban",
      "softban",
      "unban",
      "tempban-list",
    ]);
  });

  test("short queries skip substrings and loose description matches", () => {
    expect(paths(rankHelpEntries(entries, "ba"))).toEqual(["banner", "ban"]);
  });

  test("multi-word queries match phrases at word boundaries", () => {
    expect(paths(rankHelpEntries(entries, "block channel"))).toEqual([
      "xp block channel",
    ]);
    expect(paths(rankHelpEntries(entries, "tempban list"))[0]).toBe(
      "tempban-list",
    );
    expect(paths(rankHelpEntries(entries, " Tempban_List "))[0]).toBe(
      "tempban-list",
    );
  });

  test("apps match by name, not their fixed description", () => {
    expect(paths(rankHelpEntries(entries, "click"))).toEqual([]);
    expect(paths(rankHelpEntries(entries, "right"))).toEqual([]);
    expect(paths(rankHelpEntries(entries, "info"))).toContain("User Info");
  });
});

describe("findExactEntry", () => {
  test("matches paths case-insensitively, with a leading slash and extra spaces", () => {
    expect(findExactEntry(entries, "/RoleMenu  Create")?.path).toBe(
      "rolemenu create",
    );
    expect(findExactEntry(entries, "user info")?.path).toBe("User Info");
    expect(findExactEntry(entries, "xp_block-channel")?.path).toBe(
      "xp block channel",
    );
    expect(findExactEntry(entries, "tempban list")?.path).toBe("tempban-list");
  });

  test("returns null for partial and hidden names", () => {
    expect(findExactEntry(entries, "rolemen")).toBeNull();
    expect(findExactEntry(entries, "help")).toBeNull();
  });
});
