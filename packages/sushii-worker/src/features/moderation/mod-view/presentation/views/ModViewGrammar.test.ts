import { describe, expect, it } from "bun:test";
import { ComponentType, ContainerBuilder } from "discord.js";
import type { GuildMember, User } from "discord.js";

import type { EmojiMap } from "@/features/bot-emojis";
import { HISTORY_ACTION_EMOJIS } from "@/features/moderation/cases/presentation/views/HistoryView";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import type { UserInfo } from "@/features/moderation/shared/domain/types/UserInfo";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import type { UserNameHistoryEntry } from "@/features/user-name-history";
import { makeAltIdentity } from "@/test/fixtures/altIdentity";
import { makeModerationCase } from "@/test/fixtures/moderationCase";

import type { ModViewResult } from "../../application/ModViewService";
import type { ModViewTabContentBuilder } from "./ModViewMessageBuilder";
import { addTabRow } from "./components/ModViewChrome";
import { addAltsTabContent } from "./tabs/AltsTabBuilder";
import { addHistoryTabContent } from "./tabs/HistoryTabBuilder";
import { addLookupTabContent } from "./tabs/LookupTabBuilder";
import { addNamesTabContent } from "./tabs/NamesTabBuilder";
import { addOverviewTabContent } from "./tabs/OverviewTabBuilder";

const GUILD_ID = "111111111111111111";
const TARGET_ID = "222222222222222222";
const ALT_ID = "333333333333333333";
const EXECUTOR_ID = "444444444444444444";

const emojis = Object.fromEntries(
  HISTORY_ACTION_EMOJIS.map((name) => [name, `:${name}:`]),
) as EmojiMap<typeof HISTORY_ACTION_EMOJIS>;

const userInfo: UserInfo = {
  id: TARGET_ID,
  username: "target",
  avatarURL: "https://example.com/avatar.png",
  joinedAt: null,
  isBot: false,
};

const fakeUser = {
  id: TARGET_ID,
  username: "target",
  globalName: "Target",
} as unknown as User;

const fakeMember = { nickname: "TargetNick" } as unknown as GuildMember;

/**
 * No live global name or nickname — used for the "empty" scenario so Names
 * genuinely has nothing to show, rather than synthesizing a `not recorded`
 * current row from a live value that has no history at all (correct
 * behavior per `buildRows`, but not what "empty" is meant to exercise here).
 */
const noLiveValueUser = {
  id: TARGET_ID,
  username: "no-history-user",
  globalName: null,
} as unknown as User;

const noLiveValueMember = { nickname: null } as unknown as GuildMember;

function makeCases(): ModerationCase[] {
  return [
    makeModerationCase({
      guildId: GUILD_ID,
      caseId: "1",
      actionType: ActionType.Ban,
      userId: TARGET_ID,
      executorId: EXECUTOR_ID,
      reason: "posted spam links",
    }),
    makeModerationCase({
      guildId: GUILD_ID,
      caseId: "2",
      actionType: ActionType.Warn,
      userId: ALT_ID,
      executorId: EXECUTOR_ID,
      reason: null,
    }),
    makeModerationCase({
      guildId: GUILD_ID,
      caseId: "3",
      actionType: ActionType.Note,
      userId: TARGET_ID,
      executorId: null,
      reason: "checked in with the mod team",
    }),
  ];
}

function makeNameEntry(
  overrides: Partial<UserNameHistoryEntry> & { id: number },
): UserNameHistoryEntry {
  return {
    userId: BigInt(TARGET_ID),
    nameType: "username",
    guildId: null,
    value: "somevalue",
    recordedAt: new Date(),
    ...overrides,
  } as UserNameHistoryEntry;
}

/** A fully populated `ModViewResult` — every tab has at least one record. */
function makePopulatedData(): ModViewResult {
  const moderationHistory = makeCases();

  return {
    userInfo,
    history: {
      userInfo,
      moderationHistory,
      totalCases: moderationHistory.length,
      linkedIdentity: makeAltIdentity({
        guildId: GUILD_ID,
        memberIds: [TARGET_ID, ALT_ID],
      }),
    },
    lookup: {
      userInfo,
      crossServerBans: [
        {
          guildId: "555555555555555555",
          guildName: "Big Server",
          guildFeatures: ["VERIFIED"],
          guildMembers: 5000,
          reason: "raiding",
          actionTime: new Date(),
          lookupDetailsOptIn: true,
        },
        {
          guildId: "666666666666666666",
          guildName: null,
          guildFeatures: ["PARTNERED"],
          guildMembers: 200,
          reason: "spam",
          actionTime: new Date(),
          lookupDetailsOptIn: false,
        },
      ],
      currentGuildLookupOptIn: true,
    },
    names: {
      userInfo,
      history: [
        makeNameEntry({ id: 1, value: "newname", recordedAt: new Date() }),
        makeNameEntry({
          id: 2,
          value: "oldname",
          recordedAt: new Date(Date.now() - 100_000),
        }),
      ],
      eligibilityDenied: false,
    },
    identity: makeAltIdentity({
      guildId: GUILD_ID,
      memberIds: [TARGET_ID, ALT_ID],
      nickname: "Suspicious Group",
    }),
    standing: null,
  };
}

/** An entirely empty `ModViewResult` — every tab renders its empty state. */
function makeEmptyData(): ModViewResult {
  return {
    userInfo,
    history: {
      userInfo,
      moderationHistory: [],
      totalCases: 0,
      linkedIdentity: null,
    },
    lookup: {
      userInfo,
      crossServerBans: [],
      currentGuildLookupOptIn: true,
    },
    names: { userInfo, history: [], eligibilityDenied: false },
    identity: null,
    standing: null,
  };
}

/** Names ineligible, Lookup unavailable — the two "not available" branches. */
function makeUnavailableData(): ModViewResult {
  return {
    ...makeEmptyData(),
    lookup: null,
    names: { userInfo, history: [], eligibilityDenied: true },
  };
}

function renderTab(
  builder: ModViewTabContentBuilder,
  data: ModViewResult,
  overrides: { user?: User; member?: GuildMember | null } = {},
): string[] {
  const container = new ContainerBuilder();
  builder(container, {
    data,
    disabled: false,
    user: overrides.user ?? fakeUser,
    member: overrides.member ?? fakeMember,
    guildId: GUILD_ID,
    emojis,
  });
  return extractTextContents(container);
}

function extractTextContents(container: ContainerBuilder): string[] {
  const texts: string[] = [];

  function walk(node: Record<string, unknown>): void {
    if (
      node.type === ComponentType.TextDisplay &&
      typeof node.content === "string"
    ) {
      texts.push(node.content);
    }
    if (Array.isArray(node.components)) {
      for (const child of node.components as Record<string, unknown>[]) {
        walk(child);
      }
    }
    if (node.accessory && typeof node.accessory === "object") {
      walk(node.accessory as Record<string, unknown>);
    }
  }

  walk(container.toJSON() as unknown as Record<string, unknown>);
  return texts;
}

/**
 * Lines exempt from the "ends in a relative timestamp or bare integer" rule.
 * Every exemption here is called out by name in tasks.md 7.5 as output that
 * is correct by design, plus the Alts tab's identity-name control line
 * (`Identity: **name**` / `No identity name set`) — a per-screen control
 * added by design D-4.8a that the entry-list body rules were never written
 * to describe (it is neither a scope block, a label/entry line, nor an
 * overflow line). Flagged in the test report rather than silently dropped.
 */
function isLineShapeExempt(line: string): boolean {
  if (line.startsWith("-# ")) {
    return true; // scope block / overflow line / state line's subtext half
  }
  if (line.startsWith("> ")) {
    return true; // quoted continuation (free text or the truncation marker)
  }
  if (/^\*\*[^*]+\*\*$/.test(line)) {
    return true; // state line's bold fragment half
  }
  if (line.endsWith("not recorded")) {
    return true; // Names' synthesized current-value row
  }
  if (/^Identity: \*\*.+\*\*$/.test(line) || line === "No identity name set") {
    return true; // Alts identity-name control line, see doc comment above
  }
  return false;
}

function endsWithTimestampOrBareInteger(line: string): boolean {
  return /<t:\d+:R>$/.test(line) || /\d+$/.test(line);
}

const NO_HEADING = /^#{1,3}\s/m;

function assertGrammar(texts: string[]): void {
  const joined = texts.join("\n");

  expect(joined).not.toMatch(NO_HEADING);
  expect(joined).not.toContain("•");
  expect(joined).not.toContain(" – ");
  expect(joined).not.toContain(" — ");
  expect(joined).not.toContain(":f>");
  expect(joined).not.toContain(":F>");
}

function assertLineShapes(texts: string[]): void {
  for (const block of texts) {
    for (const line of block.split("\n")) {
      if (line.length === 0 || isLineShapeExempt(line)) {
        continue;
      }

      expect(
        endsWithTimestampOrBareInteger(line),
        `line does not end in a relative timestamp or bare integer: ${JSON.stringify(line)}`,
      ).toBe(true);
    }
  }
}

/**
 * Scope blocks and overflow lines (`-# …`) state structured fields — count,
 * qualifier, ordering — so a comma there is always a field separator
 * standing in for the grammar's one true separator (` · `), never prose.
 * Deliberately scoped to `-# ` lines only: body/entry lines legitimately
 * contain commas that aren't field separators (thousands-grouped numbers,
 * comma-joined mention lists), and state-line/empty-state subtext is free
 * prose exempted by design — this check would false-positive on both.
 */
function assertScopeBlocksUseOnlyDotSeparator(texts: string[]): void {
  for (const block of texts) {
    for (const line of block.split("\n")) {
      if (!line.startsWith("-# ")) {
        continue;
      }

      expect(
        line,
        `scope/overflow line uses a comma instead of the single field separator: ${JSON.stringify(line)}`,
      ).not.toMatch(/,\s/);
    }
  }
}

const ENTRY_LIST_TABS: readonly [
  name: string,
  builder: ModViewTabContentBuilder,
][] = [
  ["history", addHistoryTabContent],
  ["alts", addAltsTabContent],
  ["names", addNamesTabContent],
  ["lookup", addLookupTabContent],
];

describe("Mod View grammar conformance", () => {
  describe("populated tabs", () => {
    const data = makePopulatedData();

    for (const [name, builder] of ENTRY_LIST_TABS) {
      it(`${name}: has no heading syntax, bullets, spaced dashes or absolute timestamps`, () => {
        assertGrammar(renderTab(builder, data));
      });

      it(`${name}: every body line ends in a relative timestamp or a bare integer`, () => {
        assertLineShapes(renderTab(builder, data));
      });

      it(`${name}: scope/overflow lines use only the single field separator`, () => {
        assertScopeBlocksUseOnlyDotSeparator(renderTab(builder, data));
      });
    }

    it("overview: has no heading syntax, bullets, spaced dashes or absolute timestamps", () => {
      // Overview is the summary screen — its rows are exempt from the
      // entry-list line-shape rule, but the universal grammar rules still
      // apply everywhere (grammar scope: "Rules bind standalone views too").
      assertGrammar(renderTab(addOverviewTabContent, data));
    });

    it("overview: scope/overflow lines use only the single field separator", () => {
      assertScopeBlocksUseOnlyDotSeparator(
        renderTab(addOverviewTabContent, data),
      );
    });
  });

  describe("empty-state tabs", () => {
    const data = makeEmptyData();
    const noLiveValues = { user: noLiveValueUser, member: noLiveValueMember };

    for (const [name, builder] of ENTRY_LIST_TABS) {
      it(`${name}: empty state has no heading syntax, bullets, spaced dashes or absolute timestamps`, () => {
        assertGrammar(renderTab(builder, data, noLiveValues));
      });
    }

    // History, Alts and Lookup all reach a genuine zero-record bold+subtext
    // state line. Names is excluded: see the dedicated test below.
    for (const [name, builder] of ENTRY_LIST_TABS.filter(
      ([n]) => n !== "names",
    )) {
      it(`${name}: empty state is bold-fragment then subtext, with no other lines`, () => {
        const texts = renderTab(builder, data, noLiveValues);
        expect(texts).toHaveLength(1);
        const lines = texts[0].split("\n");
        expect(lines[0]).toMatch(/^\*\*[^*]+\*\*$/);
        expect(lines[1]).toStartWith("-# ");
      });
    }

    /**
     * The Names tab's "No name changes recorded" state line (`addStateLine`
     * branch, `total === 0`) is unreachable for any real Discord user:
     * `discord.js`'s `User.username` is a non-nullable string, so
     * `buildRows`'s `if (currentValue && !matched)` always synthesizes a
     * username row — `total` can never be 0 even with zero history rows and
     * a null `globalName`/nickname. Instead of the empty state, the tab
     * renders the synthesized live value plus a `-#` caveat that nothing was
     * actually recorded.
     */
    it("names: with zero history rows still renders the synthesized live username plus the unrecorded caveat", () => {
      const texts = renderTab(addNamesTabContent, data, noLiveValues);
      expect(texts).toHaveLength(3);
      expect(texts[0]).toBe("-# 1 name change");
      expect(texts[1]).toBe(
        `**Username** · 1\n\`@${noLiveValueUser.username}\` · current · not recorded`,
      );
      expect(texts[2]).toBe(
        "-# Name history accumulates from changes observed after tracking began.",
      );
    });
  });

  describe("unavailable-state tabs", () => {
    const data = makeUnavailableData();

    it("names: unavailable state has no heading syntax, bullets, spaced dashes or absolute timestamps", () => {
      assertGrammar(renderTab(addNamesTabContent, data));
    });

    it("lookup: unavailable state has no heading syntax, bullets, spaced dashes or absolute timestamps", () => {
      assertGrammar(renderTab(addLookupTabContent, data));
    });
  });

  it("overview row labels are string-equal to the tab button labels", () => {
    const data = makePopulatedData();

    const tabRowContainer = new ContainerBuilder();
    addTabRow(tabRowContainer, "overview", false);
    const tabLabels = (
      tabRowContainer.toJSON().components[0] as {
        components: { label: string }[];
      }
    ).components.map((b) => b.label);

    const overviewTexts = renderTab(addOverviewTabContent, data);
    const rowLabels = overviewTexts
      .map((text) => /^\*\*([^*]+)\*\*/.exec(text)?.[1])
      .filter((label): label is string => label !== undefined);

    // Overview renders exactly one row per non-Overview tab (History, Alts,
    // Names, Lookup) — each row's bold label must match that tab's button.
    const dataTabLabels = tabLabels.filter((label) => label !== "Overview");
    expect(rowLabels).toEqual(dataTabLabels);
  });
});
