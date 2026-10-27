import { describe, expect, test } from "bun:test";
import type {
  APIContainerComponent,
  APITextDisplayComponent,
  PermissionsBitField,
} from "discord.js";
import { ComponentType, MessageFlags } from "discord.js";

import {
  ALL_EMOJIS,
  KNOWN_MENTIONS,
  PERMISSIONS,
  UNKNOWN_MENTIONS,
  searchCommandList,
} from "@/test/fixtures/help";

import { buildHelpIndex } from "../../application/helpIndex";
import type { HelpDetailInput } from "./HelpDetailView";
import { buildHelpDetail } from "./HelpDetailView";

const entries = buildHelpIndex(searchCommandList());
const GEAR = ALL_EMOJIS.gear;

function render(
  query: string,
  permissions: PermissionsBitField | null,
  overrides: Partial<HelpDetailInput> = {},
): string[] {
  const payload = buildHelpDetail({
    query,
    entries,
    memberPermissions: permissions,
    emojis: ALL_EMOJIS,
    mentions: KNOWN_MENTIONS,
    guildId: "167058919611564043",
    ...overrides,
  });
  expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
  expect(payload.allowedMentions).toEqual({ parse: [] });

  const container: APIContainerComponent = payload.components[0].toJSON();
  return container.components
    .filter(
      (c): c is APITextDisplayComponent => c.type === ComponentType.TextDisplay,
    )
    .map((c) => c.content);
}

const m = (path: string) => `</${path}:1300000000000000000>`;
const FOOTER = `-# Search any command: ${m("help")} \`command:\` · Full docs: <https://sushii.bot>`;

describe("buildHelpDetail", () => {
  test("root with subcommands lists them with the permission and tab line", () => {
    expect(render("rolemenu", PERMISSIONS.rolesAdmin)).toEqual([
      `## ${GEAR} **/rolemenu**\nCreate a role menu.`,
      [
        "**Subcommands**",
        `${m("rolemenu create")} · Start a new menu`,
        `${m("rolemenu edit")} · Change title, description or limits`,
        `${m("rolemenu send")} · Post a menu in a channel`,
      ].join("\n"),
      "-# Needs **Manage Roles** · Admins tab",
      FOOTER,
    ]);
  });

  test("subcommand path focuses on it and lists its siblings", () => {
    const texts = render("rolemenu edit", PERMISSIONS.rolesAdmin);

    expect(texts.slice(0, 2)).toEqual([
      `## ${GEAR} ${m("rolemenu edit")}\nChange title, description or limits`,
      [
        "**Also in /rolemenu**",
        `${m("rolemenu create")} · Start a new menu`,
        `${m("rolemenu send")} · Post a menu in a channel`,
      ].join("\n"),
    ]);
  });

  test("group subcommands use their full path", () => {
    const texts = render("xp", PERMISSIONS.admin);

    expect(texts[1]).toBe(
      [
        "**Subcommands**",
        `${m("xp block channel")} · Block XP in a channel`,
        `${m("xp block role")} · Block XP for a role`,
      ].join("\n"),
    );
    expect(texts[2]).toBe("-# Needs **Manage Server** · Admins tab");
  });

  test("command without a permission shows only the tab", () => {
    const texts = render("rank", PERMISSIONS.member, {
      mentions: UNKNOWN_MENTIONS,
    });

    expect(texts[0]).toBe(`## ${ALL_EMOJIS.level_server} \`/rank\`\nrank`);
    expect(texts[1]).toBe("-# Members tab");
  });

  test("app explains where to find it", () => {
    expect(render("submit to mods", PERMISSIONS.member).slice(0, 2)).toEqual([
      "## Submit to Mods\nRight-click a message → Apps → **Submit to Mods**",
      "-# Members tab",
    ]);
  });

  test("free text suggests runnable matches", () => {
    const texts = render("leader", PERMISSIONS.member);

    expect(texts[0]).toBe("No command called `leader`.");
    expect(texts[1]).toBe(
      [
        "**Did you mean**",
        `${m("leaderboard")} · leaderboard`,
        `${m("leaderboard-privacy")} · leaderboard-privacy`,
        `${m("fishy-leaderboard")} · fishy-leaderboard`,
        `${m("rep-leaderboard")} · rep-leaderboard`,
        `${m("global-leaderboard")} · global-leaderboard`,
      ].join("\n"),
    );
  });

  test("free text never suggests commands the member can't run", () => {
    const texts = render("ba", PERMISSIONS.member);

    expect(texts[1]).toBe(`**Did you mean**\n${m("banner")} · banner`);
    expect(render("ba", PERMISSIONS.moderator)[1]).toContain(m("ban"));
  });

  test("exact match collapses whitespace, underscores and hyphens", () => {
    expect(render(" XP_block   channel ", PERMISSIONS.admin)[0]).toBe(
      `## ${GEAR} ${m("xp block channel")}\nBlock XP in a channel`,
    );
  });

  test("multi-word free text suggests matching subcommands", () => {
    expect(render("block chan", PERMISSIONS.admin)[1]).toBe(
      `**Did you mean**\n${m("xp block channel")} · Block XP in a channel`,
    );
  });

  test("no member permissions still renders cards and permission notes", () => {
    expect(render("rank", null)[1]).toBe("-# Members tab");
    expect(render("ban", null)[0]).toBe(
      `You don't have permission to use ${m("ban")}. It needs **Ban Members**.`,
    );
  });

  test("hidden commands read as unknown", () => {
    const texts = render("help", PERMISSIONS.admin);

    expect(texts[0]).toBe(
      `No command called \`help\`.\nNothing matched. Try ${m("help")} without a search.`,
    );
  });

  test("exact match without permission names the requirement and skips the card", () => {
    const texts = render("rolemenu", PERMISSIONS.member);

    expect(texts).toEqual([
      `You don't have permission to use **/rolemenu**. It needs **Manage Roles**.`,
      FOOTER,
    ]);
  });

  test("admin-only commands need Administrator", () => {
    const texts = render("mystery", PERMISSIONS.admin, {
      entries: buildHelpIndex([
        {
          name: "mystery",
          description: "Owner tools",
          default_member_permissions: "0",
        },
      ]),
    });

    expect(texts[0]).toBe(
      `You don't have permission to use ${m("mystery")}. It needs **Administrator**.`,
    );
  });

  test("query is code-wrapped with backticks removed and truncated", () => {
    expect(render("**x** <@1> `@everyone`", PERMISSIONS.member)[0]).toStartWith(
      "No command called `**x** <@1> @everyone`.",
    );
    expect(render("```", PERMISSIONS.member)[0]).toStartWith(
      "No command matched your search.",
    );
    expect(render("q".repeat(200), PERMISSIONS.member)[0]).toStartWith(
      `No command called \`${"q".repeat(49)}…\`.`,
    );
    expect(
      render(
        `${"q".repeat(48)}\u{1F600}${"q".repeat(10)}`,
        PERMISSIONS.member,
      )[0],
    ).toStartWith(`No command called \`${"q".repeat(48)}\u{1F600}…\`.`);
  });
});
