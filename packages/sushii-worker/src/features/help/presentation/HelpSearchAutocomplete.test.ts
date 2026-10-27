import { describe, expect, mock, test } from "bun:test";
import type {
  APIApplicationCommandOptionChoice,
  AutocompleteFocusedOption,
  AutocompleteInteraction,
  RESTPostAPIApplicationCommandsJSONBody,
} from "discord.js";
import { ApplicationCommandOptionType } from "discord.js";

import { PERMISSIONS, searchCommandList } from "@/test/fixtures/help";

import { buildHelpIndex } from "../application/helpIndex";
import {
  HelpSearchAutocomplete,
  buildHelpChoices,
} from "./HelpSearchAutocomplete";

const BEFORE_NEW_ENDS = new Date("2026-10-26T12:00:00Z");
const AFTER_NEW_ENDS = new Date("2026-11-25T00:00:00Z");
const EMOJI = /\p{Extended_Pictographic}/u;

const entries = buildHelpIndex(searchCommandList());
const values = (choices: APIApplicationCommandOptionChoice<string>[]) =>
  choices.map((c) => c.value);

describe("buildHelpChoices", () => {
  test("formats slash commands and apps", () => {
    const choices = buildHelpChoices(
      entries,
      "user",
      PERMISSIONS.member,
      BEFORE_NEW_ENDS,
    );

    expect(choices).toContainEqual({
      name: "/userinfo · userinfo",
      value: "userinfo",
    });
    expect(choices).toContainEqual({
      name: "User Info (right-click app)",
      value: "User Info",
    });
  });

  test("hides commands the member can't run", () => {
    const member = values(
      buildHelpChoices(entries, "ban", PERMISSIONS.member, BEFORE_NEW_ENDS),
    );
    const moderator = values(
      buildHelpChoices(entries, "ban", PERMISSIONS.moderator, BEFORE_NEW_ENDS),
    );

    expect(member).toEqual(["banner"]);
    expect(moderator).toContain("ban");
    expect(moderator).toContain("tempban");
  });

  test("caps choices at 25 with names and values within 100 characters and no emoji", () => {
    const long = "x".repeat(150);
    const commands = Array.from(
      { length: 40 },
      (_, i) =>
        ({
          name: `cmd-${i}`,
          description: long,
          options: [
            {
              type: ApplicationCommandOptionType.Subcommand,
              name: "sub",
              description: long,
            },
          ],
        }) as RESTPostAPIApplicationCommandsJSONBody,
    );
    const choices = buildHelpChoices(
      buildHelpIndex(commands),
      "cmd",
      PERMISSIONS.member,
      BEFORE_NEW_ENDS,
    );

    expect(choices).toHaveLength(25);
    for (const choice of choices) {
      expect(choice.name.length).toBeLessThanOrEqual(100);
      expect(choice.value.length).toBeLessThanOrEqual(100);
      expect(choice.name.endsWith("…")).toBe(true);
    }
  });

  test("no choice name contains emoji, for any query or audience", () => {
    for (const query of ["", "a", "e", "role"]) {
      for (const permissions of Object.values(PERMISSIONS)) {
        const choices = buildHelpChoices(
          entries,
          query,
          permissions,
          BEFORE_NEW_ENDS,
        );
        expect(choices.filter((c) => EMOJI.test(c.name))).toEqual([]);
      }
    }
  });

  test("empty query lists runnable new commands first, then the rest", () => {
    const admin = buildHelpChoices(
      entries,
      "  ",
      PERMISSIONS.admin,
      BEFORE_NEW_ENDS,
    );
    const member = buildHelpChoices(
      entries,
      "",
      PERMISSIONS.member,
      BEFORE_NEW_ENDS,
    );

    expect(admin.slice(0, 2).map((c) => c.name)).toEqual([
      "New · /permission-audit · permission-audit",
      "New · /fishy-collection · fishy-collection",
    ]);
    expect(admin).toHaveLength(25);
    expect(values(admin).slice(2, 5)).toEqual(["settings", "levelrole", "xp"]);
    expect(member[0].name).toBe("New · /fishy-collection · fishy-collection");
    expect(values(member)).not.toContain("permission-audit");
    expect(values(member).filter((v) => v === "fishy-collection")).toHaveLength(
      1,
    );
  });

  test("empty query lists the highest usable audience first", () => {
    const moderator = values(
      buildHelpChoices(entries, "", PERMISSIONS.moderator, AFTER_NEW_ENDS),
    );
    const admin = values(
      buildHelpChoices(entries, "", PERMISSIONS.admin, AFTER_NEW_ENDS),
    );

    expect(moderator.slice(0, 2)).toEqual(["ban", "warn"]);
    expect(admin.indexOf("settings")).toBe(0);
    expect(admin.indexOf("permission-audit")).toBeLessThan(
      admin.indexOf("ban"),
    );
    expect(admin.indexOf("note")).toBeLessThan(admin.indexOf("lookup"));
  });

  test("no member permissions shows only commands without a requirement", () => {
    const choices = values(
      buildHelpChoices(entries, "", null, BEFORE_NEW_ENDS),
    );
    const search = values(
      buildHelpChoices(entries, "ban", null, BEFORE_NEW_ENDS),
    );

    expect(choices).toContain("fishy");
    expect(choices).not.toContain("ban");
    expect(search).toEqual(["banner"]);
  });

  test("ranks the exact command first for a moderator", () => {
    const choices = values(
      buildHelpChoices(entries, "ban", PERMISSIONS.moderator, BEFORE_NEW_ENDS),
    );

    expect(choices.slice(0, 2)).toEqual(["ban", "banner"]);
    expect(choices).toContain("unban");
    expect(
      values(
        buildHelpChoices(entries, "ba", PERMISSIONS.member, BEFORE_NEW_ENDS),
      ),
    ).not.toContain("global-leaderboard");
  });

  test("collapses whitespace and underscores in multi-word queries", () => {
    const choices = values(
      buildHelpChoices(
        entries,
        "  block_ channel ",
        PERMISSIONS.admin,
        BEFORE_NEW_ENDS,
      ),
    );

    expect(choices).toEqual(["xp block channel"]);
  });

  test("truncates by code point without splitting an emoji at the cut", () => {
    const description = `${"x".repeat(93)}\u{1F600}${"y".repeat(10)}`;
    const [choice] = buildHelpChoices(
      buildHelpIndex([
        { name: "e", description } as RESTPostAPIApplicationCommandsJSONBody,
      ]),
      "e",
      PERMISSIONS.member,
      BEFORE_NEW_ENDS,
    );

    expect(choice.name).toBe(`/e · ${"x".repeat(93)}\u{1F600}…`);
    expect(Array.from(choice.name)).toHaveLength(100);
  });

  test("empty query drops the New prefix once the window ends", () => {
    const choices = buildHelpChoices(
      entries,
      "",
      PERMISSIONS.member,
      AFTER_NEW_ENDS,
    );

    expect(choices.some((c) => c.name.startsWith("New"))).toBe(false);
    expect(values(choices).slice(0, 3)).toEqual([
      "fishy",
      "rep",
      "fishy-collection",
    ]);
  });
});

describe("HelpSearchAutocomplete", () => {
  test("responds with ranked choices for the focused value", async () => {
    const handler = new HelpSearchAutocomplete(
      searchCommandList,
      () => BEFORE_NEW_ENDS,
    );
    const respond = mock(() => Promise.resolve());
    const interaction = {
      memberPermissions: PERMISSIONS.rolesAdmin,
      respond,
    } as unknown as AutocompleteInteraction;

    await handler.handler(interaction, {
      name: "command",
      type: ApplicationCommandOptionType.String,
      value: "rolemenu c",
      focused: true,
    } as AutocompleteFocusedOption);

    expect(respond).toHaveBeenCalledWith([
      { name: "/rolemenu create · Start a new menu", value: "rolemenu create" },
    ]);
  });
});
