import { describe, expect, it } from "bun:test";
import { ComponentType, ContainerBuilder } from "discord.js";
import type { GuildMember, User } from "discord.js";

import type { EmojiMap } from "@/features/bot-emojis";
import {
  HISTORY_ACTION_EMOJIS,
  formatModerationCase,
} from "@/features/moderation/cases/presentation/views/HistoryView";
import type { ModViewResult } from "@/features/moderation/mod-view/application/ModViewService";
import { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import type { UserInfo } from "@/features/moderation/shared/domain/types/UserInfo";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import { Reason } from "@/features/moderation/shared/domain/value-objects/Reason";
import type { UserNameHistoryEntry } from "@/features/user-name-history";
import { makeModerationCase } from "@/test/fixtures/moderationCase";

import { MODVIEW_CUSTOM_IDS } from "../../customIds";
import type { ModViewTabContentOptions } from "../ModViewMessageBuilder";
import { addNamesTabContent } from "./NamesTabBuilder";
import { addOverviewTabContent } from "./OverviewTabBuilder";

const GUILD_ID = "111111111111111111";
const OTHER_GUILD_ID = "999999999999999999";
const TARGET_ID = "222222222222222222";
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

const user = {
  id: TARGET_ID,
  username: "target",
  globalName: null,
} as unknown as User;

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

/** Recursively find every button `custom_id`+`disabled` pair in the rendered container. */
function extractButtons(
  container: ContainerBuilder,
): { customId: string; disabled: boolean }[] {
  const buttons: { customId: string; disabled: boolean }[] = [];

  function walk(node: Record<string, unknown>): void {
    if (
      node.type === ComponentType.Button &&
      typeof node.custom_id === "string"
    ) {
      buttons.push({
        customId: node.custom_id,
        disabled: Boolean(node.disabled),
      });
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
  return buttons;
}

let nextId = 1;

function makeNicknameEntry(
  guildId: string,
  value: string,
  recordedAt: Date,
): UserNameHistoryEntry {
  return {
    id: nextId++,
    userId: BigInt(TARGET_ID),
    nameType: "nickname",
    guildId: BigInt(guildId),
    value,
    recordedAt,
  } as UserNameHistoryEntry;
}

function makeData(overrides: {
  moderationHistory?: ModerationCase[];
  namesHistory?: UserNameHistoryEntry[];
}): ModViewResult {
  const moderationHistory = overrides.moderationHistory ?? [];

  return {
    userInfo,
    history: {
      userInfo,
      moderationHistory,
      totalCases: moderationHistory.length,
      linkedIdentity: null,
    },
    lookup: null,
    names: {
      userInfo,
      history: overrides.namesHistory ?? [],
      eligibilityDenied: false,
    },
    identity: null,
    standing: null,
  };
}

function baseOptions(
  data: ModViewResult,
  overrides: Partial<ModViewTabContentOptions> = {},
): ModViewTabContentOptions {
  return {
    data,
    disabled: false,
    user,
    member: null as unknown as GuildMember,
    guildId: GUILD_ID,
    emojis,
    ...overrides,
  };
}

function renderOverview(
  data: ModViewResult,
  overrides: Partial<ModViewTabContentOptions> = {},
): { texts: string[]; buttons: { customId: string; disabled: boolean }[] } {
  const container = new ContainerBuilder();
  addOverviewTabContent(container, baseOptions(data, overrides));
  return {
    texts: extractTextContents(container),
    buttons: extractButtons(container),
  };
}

function renderNamesScope(
  data: ModViewResult,
  overrides: Partial<ModViewTabContentOptions> = {},
): string {
  const container = new ContainerBuilder();
  addNamesTabContent(container, baseOptions(data, overrides));
  return extractTextContents(container)[0];
}

describe("OverviewTabBuilder — Names count parity", () => {
  it("agrees with the Names tab's own recorded-change count for the same fixture", () => {
    const data = makeData({
      namesHistory: [
        makeNicknameEntry(GUILD_ID, "InGuildNick", new Date("2024-01-01")),
        makeNicknameEntry(
          OTHER_GUILD_ID,
          "ForeignNick",
          new Date("2024-02-01"),
        ),
      ],
    });

    const { texts } = renderOverview(data);
    const namesRow = texts.find((t) => t.startsWith("**Names**"));
    expect(namesRow).toBe("**Names** · 1 change");

    const namesScopeLine = renderNamesScope(data);
    expect(namesScopeLine).toBe("-# 1 name change");
  });

  it("never counts a foreign guild's nickname activity — a user with only foreign nicknames reads as zero changes", () => {
    const data = makeData({
      namesHistory: [
        makeNicknameEntry(
          OTHER_GUILD_ID,
          "ForeignNick",
          new Date("2024-02-01"),
        ),
      ],
    });

    const { texts, buttons } = renderOverview(data);
    const namesRow = texts.find((t) => t.startsWith("**Names**"));
    expect(namesRow).toBe("**Names** · 0 changes");

    // Disabled `View ›` on `· 0`, matching addSummaryRow's own contract.
    const namesButton = buttons.find(
      (b) => b.customId === MODVIEW_CUSTOM_IDS.openNames,
    );
    expect(namesButton?.disabled).toBe(true);
  });

  it("still shows the empty state when history/alts are also empty and only a foreign nickname exists", () => {
    const data = makeData({
      namesHistory: [
        makeNicknameEntry(
          OTHER_GUILD_ID,
          "ForeignNick",
          new Date("2024-02-01"),
        ),
      ],
    });

    const { texts } = renderOverview(data);
    expect(texts.some((t) => t.startsWith("**Nothing recorded**"))).toBe(true);
  });
});

describe("OverviewTabBuilder — most recent case rendering", () => {
  it("renders the case identically to the History tab's formatModerationCase", () => {
    const moderationCase = makeModerationCase({
      guildId: GUILD_ID,
      caseId: "1",
      actionType: ActionType.Warn,
      userId: TARGET_ID,
      executorId: EXECUTOR_ID,
      reason: "posted spam links",
    });

    const data = makeData({ moderationHistory: [moderationCase] });
    const { texts } = renderOverview(data);

    const expected = formatModerationCase(moderationCase, emojis, false);
    expect(texts).toContain(expected);
  });

  it("preserves timeout duration and attachment lines, which the old hand-built line dropped", () => {
    const moderationCase = ModerationCase.create(
      GUILD_ID,
      "1",
      ActionType.Timeout,
      TARGET_ID,
      "TestUser#0001",
      EXECUTOR_ID,
      Reason.create("spamming").unwrap(),
      undefined,
      ["https://cdn.discordapp.com/attachments/1/2/proof.png"],
      3600,
    );

    const data = makeData({ moderationHistory: [moderationCase] });
    const { texts } = renderOverview(data);

    const expected = formatModerationCase(moderationCase, emojis, false);
    expect(texts).toContain(expected);
    expect(expected).toContain("hour");
    expect(expected).toContain("proof.png");
  });
});
