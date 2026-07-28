import { describe, expect, it } from "bun:test";
import { Collection, type GuildMember, type User } from "discord.js";

import type { EmojiMap } from "@/features/bot-emojis";
import { HISTORY_ACTION_EMOJIS } from "@/features/moderation/cases/presentation/views/HistoryView";
import { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import { Reason } from "@/features/moderation/shared/domain/value-objects/Reason";
import { makeAltIdentity } from "@/test/fixtures/altIdentity";

import type { ModViewResult } from "../../application/ModViewService";
import { MODVIEW_CUSTOM_IDS } from "../customIds";
import { createModViewMessage } from "./ModViewMessageBuilder";
import type {
  ModViewMessageOptions,
  ModViewTabContentOptions,
} from "./ModViewMessageBuilder";
import type { ModViewTab } from "./components/ModViewChrome";

const GUILD_ID = "111111111111111111";
const TARGET_ID = "222222222222222222";
const ALT_ID = "333333333333333333";
const EXECUTOR_ID = "444444444444444444";

const mockEmojis = Object.fromEntries(
  HISTORY_ACTION_EMOJIS.map((name) => [name, `:${name}:`]),
) as EmojiMap<typeof HISTORY_ACTION_EMOJIS>;

const ALL_TABS: ModViewTab[] = [
  "overview",
  "history",
  "alts",
  "names",
  "lookup",
];

function makeUser(): User {
  return {
    id: TARGET_ID,
    username: "target_user",
    globalName: "Target",
    createdTimestamp: Date.now() - 1000 * 60 * 60 * 24 * 365,
    displayAvatarURL: () => "https://example.com/avatar.png",
  } as unknown as User;
}

function makeRole(name: string, position: number, permissionBits: bigint) {
  return {
    name,
    position,
    permissions: { bitfield: permissionBits },
  };
}

function makeMember(): GuildMember {
  const roles = new Collection<string, ReturnType<typeof makeRole>>();
  roles.set("everyone", makeRole("@everyone", 0, 0n));
  roles.set("mod", makeRole("Moderator", 1, 8n));

  return {
    nickname: "TargetNick",
    joinedTimestamp: Date.now() - 1000 * 60 * 60 * 24 * 30,
    roles: { cache: roles },
  } as unknown as GuildMember;
}

/** A single moderation case with a specific type/target/timestamp, for breakdown/history fixtures. */
function makeCase(
  caseId: string,
  actionType: ActionType,
  userId: string,
  reason: string | null = null,
): ModerationCase {
  return new ModerationCase(
    GUILD_ID,
    caseId,
    actionType,
    new Date(Date.now() - Number(caseId) * 1000),
    userId,
    "TestUser#0001",
    EXECUTOR_ID,
    Reason.create(reason).unwrap(),
  );
}

/**
 * A target with history across linked accounts, an identity, name changes,
 * and cross-server bans — the "everything present" case that exercises
 * every optional line each tab can render.
 */
function makeFullData(): ModViewResult {
  const identity = makeAltIdentity({
    guildId: GUILD_ID,
    nickname: "Main Identity",
    memberIds: [TARGET_ID, ALT_ID],
    linkedBy: EXECUTOR_ID,
  });

  const moderationHistory = [
    makeCase("1", ActionType.Ban, TARGET_ID, "spamming"),
    makeCase("2", ActionType.BanRemove, TARGET_ID),
    makeCase("3", ActionType.Timeout, ALT_ID, "harassment"),
    makeCase("4", ActionType.TimeoutRemove, ALT_ID),
    makeCase("5", ActionType.Warn, TARGET_ID, "rule 3"),
    makeCase("6", ActionType.Note, TARGET_ID, "watch this user"),
  ];

  return {
    userInfo: {
      id: TARGET_ID,
      username: "target_user",
      avatarURL: "https://example.com/avatar.png",
      joinedAt: new Date(),
      isBot: false,
    },
    history: {
      userInfo: {
        id: TARGET_ID,
        username: "target_user",
        avatarURL: "https://example.com/avatar.png",
        joinedAt: new Date(),
        isBot: false,
      },
      moderationHistory,
      totalCases: moderationHistory.length,
      linkedIdentity: identity,
    },
    lookup: {
      userInfo: {
        id: TARGET_ID,
        username: "target_user",
        avatarURL: "https://example.com/avatar.png",
        joinedAt: new Date(),
        isBot: false,
      },
      crossServerBans: [
        {
          guildId: "555555555555555555",
          guildName: "Opted-in Server",
          guildFeatures: ["DISCOVERABLE"],
          guildMembers: 5000,
          reason: "cross-server spam",
          actionTime: new Date(),
          lookupDetailsOptIn: true,
        },
        {
          guildId: "666666666666666666",
          guildName: null,
          guildFeatures: [],
          guildMembers: 0,
          reason: null,
          actionTime: new Date(),
          lookupDetailsOptIn: false,
        },
      ],
      currentGuildLookupOptIn: true,
    },
    names: {
      userInfo: {
        id: TARGET_ID,
        username: "target_user",
        avatarURL: "https://example.com/avatar.png",
        joinedAt: new Date(),
        isBot: false,
      },
      history: [
        {
          id: 1,
          userId: BigInt(TARGET_ID),
          nameType: "username",
          guildId: null,
          value: "old_username",
          recordedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10),
        },
        {
          id: 2,
          userId: BigInt(TARGET_ID),
          nameType: "global_name",
          guildId: null,
          value: "Old Display",
          recordedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5),
        },
        {
          id: 3,
          userId: BigInt(TARGET_ID),
          nameType: "nickname",
          guildId: BigInt(GUILD_ID),
          value: "OldNick",
          recordedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2),
        },
      ],
      eligibilityDenied: false,
    },
    identity,
    standing: null,
  };
}

/** No records, no linked accounts, no name changes, no bans — the all-zero summary case. */
function makeEmptyData(): ModViewResult {
  const emptyUserInfo = {
    id: TARGET_ID,
    username: "target_user",
    avatarURL: "https://example.com/avatar.png",
    joinedAt: new Date(),
    isBot: false,
  };

  return {
    userInfo: emptyUserInfo,
    history: {
      userInfo: emptyUserInfo,
      moderationHistory: [],
      totalCases: 0,
      linkedIdentity: null,
    },
    lookup: {
      userInfo: emptyUserInfo,
      crossServerBans: [],
      currentGuildLookupOptIn: true,
    },
    names: {
      userInfo: emptyUserInfo,
      history: [],
      eligibilityDenied: false,
    },
    identity: null,
    standing: null,
  };
}

/** Lookup and names screens both unavailable — the "· not available" summary case. */
function makeUnavailableData(): ModViewResult {
  const data = makeEmptyData();

  return {
    ...data,
    lookup: null,
    names: {
      ...data.names,
      eligibilityDenied: true,
    },
  };
}

function makeTabContentOptions(
  data: ModViewResult,
  disabled: boolean,
): ModViewTabContentOptions {
  return {
    data,
    disabled,
    user: makeUser(),
    member: makeMember(),
    guildId: GUILD_ID,
    emojis: mockEmojis,
  };
}

function buildMessage(
  activeTab: ModViewTab,
  data: ModViewResult,
  disabled: boolean,
): ReturnType<typeof createModViewMessage> {
  const options: ModViewMessageOptions = {
    user: makeUser(),
    member: makeMember(),
    standing: data.standing,
    activeTab,
    disabled,
    tabContentOptions: makeTabContentOptions(data, disabled),
  };

  return createModViewMessage(options);
}

/**
 * Recursively count all components in a component tree, including nested
 * children and accessories (e.g. button accessory on Section). Copied from
 * `SettingsMessageBuilder.test.ts`, the reference implementation for this
 * counter.
 */
function countComponents(component: Record<string, unknown>): number {
  let count = 1;

  if (Array.isArray(component.components)) {
    for (const child of component.components as Record<string, unknown>[]) {
      count += countComponents(child);
    }
  }

  if (component.accessory && typeof component.accessory === "object") {
    count += countComponents(component.accessory as Record<string, unknown>);
  }

  return count;
}

function totalComponentCount(
  message: ReturnType<typeof createModViewMessage>,
): number {
  let total = 0;
  for (const topLevel of message.components) {
    total += countComponents(
      topLevel.toJSON() as unknown as Record<string, unknown>,
    );
  }
  return total;
}

/** Recursively collect every `custom_id` in a component tree, including section accessories. */
function collectCustomIds(
  component: Record<string, unknown>,
  ids: string[],
): void {
  if (typeof component.custom_id === "string") {
    ids.push(component.custom_id);
  }

  if (Array.isArray(component.components)) {
    for (const child of component.components as Record<string, unknown>[]) {
      collectCustomIds(child, ids);
    }
  }

  if (component.accessory && typeof component.accessory === "object") {
    collectCustomIds(component.accessory as Record<string, unknown>, ids);
  }
}

function allCustomIds(
  message: ReturnType<typeof createModViewMessage>,
): string[] {
  const ids: string[] = [];
  for (const topLevel of message.components) {
    collectCustomIds(
      topLevel.toJSON() as unknown as Record<string, unknown>,
      ids,
    );
  }
  return ids;
}

const DISCORD_MAX_COMPONENTS = 40;

describe("createModViewMessage component budget", () => {
  const dataVariants: [string, ModViewResult][] = [
    ["full data", makeFullData()],
    ["empty data", makeEmptyData()],
    ["unavailable data", makeUnavailableData()],
  ];

  for (const tab of ALL_TABS) {
    for (const [variantName, data] of dataVariants) {
      it(`${tab} tab (${variantName}, enabled) stays within ${DISCORD_MAX_COMPONENTS} components`, () => {
        const message = buildMessage(tab, data, false);
        expect(totalComponentCount(message)).toBeLessThanOrEqual(
          DISCORD_MAX_COMPONENTS,
        );
      });

      it(`${tab} tab (${variantName}, disabled) stays within ${DISCORD_MAX_COMPONENTS} components`, () => {
        const message = buildMessage(tab, data, true);
        expect(totalComponentCount(message)).toBeLessThanOrEqual(
          DISCORD_MAX_COMPONENTS,
        );
      });
    }
  }
});

describe("createModViewMessage custom ID uniqueness", () => {
  const fullData = makeFullData();

  for (const tab of ALL_TABS) {
    it(`${tab} tab (enabled) has no duplicate custom IDs across the full render`, () => {
      const message = buildMessage(tab, fullData, false);
      const ids = allCustomIds(message);
      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it(`${tab} tab (disabled) has no duplicate custom IDs across the full render`, () => {
      const message = buildMessage(tab, fullData, true);
      const ids = allCustomIds(message);
      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
    });
  }
});

describe("createModViewMessage component order", () => {
  it("renders identity header, then tab row, then content — in that order", () => {
    const message = buildMessage("history", makeFullData(), false);
    const container = message.components[0].toJSON() as unknown as {
      components: Record<string, unknown>[];
    };

    // Identity header: a Section (type 9) with a thumbnail accessory, no custom_id.
    const [header, tabRow, ...content] = container.components;
    expect(header.type).toBe(9);
    expect(header.accessory).toBeTruthy();
    expect(
      (header.accessory as { custom_id?: string }).custom_id,
    ).toBeUndefined();

    // Tab row: an Action Row (type 1) whose buttons are exactly the 5 tab IDs.
    expect(tabRow.type).toBe(1);
    const tabRowIds = (tabRow.components as { custom_id: string }[]).map(
      (b) => b.custom_id,
    );
    expect(tabRowIds).toEqual([
      MODVIEW_CUSTOM_IDS.tabOverview,
      MODVIEW_CUSTOM_IDS.tabHistory,
      MODVIEW_CUSTOM_IDS.tabAlts,
      MODVIEW_CUSTOM_IDS.tabNames,
      MODVIEW_CUSTOM_IDS.tabLookup,
    ]);

    // Content (the History tab's scope section + body) comes after chrome.
    expect(content.length).toBeGreaterThan(0);
  });

  it("keeps header before tab row for every tab", () => {
    for (const tab of ALL_TABS) {
      const message = buildMessage(tab, makeFullData(), false);
      const container = message.components[0].toJSON() as unknown as {
        components: Record<string, unknown>[];
      };

      const headerIndex = container.components.findIndex(
        (c) => c.type === 9 && c.accessory,
      );
      const tabRowIndex = container.components.findIndex(
        (c) =>
          c.type === 1 &&
          Array.isArray((c as { components?: unknown[] }).components) &&
          (c.components as { custom_id?: string }[]).some(
            (b) => b.custom_id === MODVIEW_CUSTOM_IDS.tabOverview,
          ),
      );

      expect(headerIndex).toBeGreaterThanOrEqual(0);
      expect(tabRowIndex).toBeGreaterThan(headerIndex);
    }
  });
});

interface TabButtonJSON {
  custom_id: string;
  style: number;
  disabled?: boolean;
}

function getTabRowButtons(
  message: ReturnType<typeof createModViewMessage>,
): TabButtonJSON[] {
  const container = message.components[0].toJSON() as unknown as {
    components: Record<string, unknown>[];
  };
  const tabRow = container.components.find(
    (c) =>
      c.type === 1 &&
      Array.isArray((c as { components?: unknown[] }).components) &&
      (c.components as { custom_id?: string }[]).some((b) =>
        (Object.values(MODVIEW_CUSTOM_IDS) as string[])
          .filter((id) => id.startsWith("modview_tab_"))
          .includes(b.custom_id ?? ""),
      ),
  );
  return (tabRow?.components ?? []) as unknown as TabButtonJSON[];
}

const TAB_BUTTON_IDS: Record<ModViewTab, string> = {
  overview: MODVIEW_CUSTOM_IDS.tabOverview,
  history: MODVIEW_CUSTOM_IDS.tabHistory,
  alts: MODVIEW_CUSTOM_IDS.tabAlts,
  names: MODVIEW_CUSTOM_IDS.tabNames,
  lookup: MODVIEW_CUSTOM_IDS.tabLookup,
};

const BUTTON_STYLE_PRIMARY = 1;
const BUTTON_STYLE_SECONDARY = 2;

describe("createModViewMessage tab row buttons", () => {
  for (const activeTab of ALL_TABS) {
    it(`live state: all five tab buttons present, "${activeTab}" is Primary+disabled, the rest are Secondary+enabled`, () => {
      const message = buildMessage(activeTab, makeFullData(), false);
      const buttons = getTabRowButtons(message);

      expect(buttons).toHaveLength(5);
      expect(buttons.map((b) => b.custom_id).sort()).toEqual(
        Object.values(TAB_BUTTON_IDS).sort(),
      );

      const disabledButtons = buttons.filter((b) => b.disabled);
      expect(disabledButtons).toHaveLength(1);
      expect(disabledButtons[0].custom_id).toBe(TAB_BUTTON_IDS[activeTab]);

      for (const button of buttons) {
        const isActive = button.custom_id === TAB_BUTTON_IDS[activeTab];
        expect(button.style).toBe(
          isActive ? BUTTON_STYLE_PRIMARY : BUTTON_STYLE_SECONDARY,
        );
        expect(button.disabled ?? false).toBe(isActive);
      }
    });

    it(`expired state (disabled: true): all five tab buttons render Secondary + disabled for "${activeTab}"`, () => {
      const message = buildMessage(activeTab, makeFullData(), true);
      const buttons = getTabRowButtons(message);

      expect(buttons).toHaveLength(5);
      for (const button of buttons) {
        expect(button.style).toBe(BUTTON_STYLE_SECONDARY);
        expect(button.disabled).toBe(true);
      }
    });
  }
});

interface SummaryRowJSON {
  labelText: string;
  buttonDisabled: boolean;
}

function getOverviewSummaryRows(
  message: ReturnType<typeof createModViewMessage>,
): SummaryRowJSON[] {
  const container = message.components[0].toJSON() as unknown as {
    components: Record<string, unknown>[];
  };

  const rows: SummaryRowJSON[] = [];
  for (const component of container.components) {
    if (component.type !== 9) {
      continue;
    }
    const accessory = component.accessory as
      | { type?: number; custom_id?: string; disabled?: boolean }
      | undefined;
    if (!accessory || accessory.type !== 2) {
      continue;
    }
    // Skip the identity header section, whose accessory is a thumbnail (type 11), not a button.
    const texts = (
      component.components as { content?: string }[] | undefined
    )?.map((t) => t.content ?? "");
    rows.push({
      labelText: texts?.join("\n") ?? "",
      buttonDisabled: accessory.disabled ?? false,
    });
  }
  return rows;
}

describe("createModViewMessage Overview 'View ›' accessory disabled state", () => {
  it("is disabled on a row stating a zero count", () => {
    const message = buildMessage("overview", makeEmptyData(), false);
    const rows = getOverviewSummaryRows(message);

    const altsRow = rows.find((r) => r.labelText.includes("**Alts**"));
    expect(altsRow).toBeTruthy();
    expect(altsRow?.labelText).toContain("· 0");
    expect(altsRow?.buttonDisabled).toBe(true);

    const historyRow = rows.find((r) => r.labelText.includes("**History**"));
    expect(historyRow).toBeTruthy();
    expect(historyRow?.labelText).toContain("· 0");
    expect(historyRow?.buttonDisabled).toBe(true);
  });

  it("is enabled on a row stating 'not available'", () => {
    const message = buildMessage("overview", makeUnavailableData(), false);
    const rows = getOverviewSummaryRows(message);

    const lookupRow = rows.find((r) => r.labelText.includes("**Lookup**"));
    expect(lookupRow).toBeTruthy();
    expect(lookupRow?.labelText).toContain("not available");
    expect(lookupRow?.buttonDisabled).toBe(false);

    const namesRow = rows.find((r) => r.labelText.includes("**Names**"));
    expect(namesRow).toBeTruthy();
    expect(namesRow?.labelText).toContain("not available");
    expect(namesRow?.buttonDisabled).toBe(false);
  });
});
