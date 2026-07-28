import { describe, expect, it } from "bun:test";
import { ComponentType, ContainerBuilder } from "discord.js";
import type { GuildMember, User } from "discord.js";

import type { EmojiMap } from "@/features/bot-emojis";
import { HISTORY_ACTION_EMOJIS } from "@/features/moderation/cases/presentation/views/HistoryView";
import type { ModViewResult } from "@/features/moderation/mod-view/application/ModViewService";
import type { UserInfo } from "@/features/moderation/shared/domain/types/UserInfo";
import type { UserNameHistoryEntry } from "@/features/user-name-history";

import type { ModViewTabContentOptions } from "../ModViewMessageBuilder";
import { addNamesTabContent } from "./NamesTabBuilder";

const GUILD_ID = "111111111111111111";
const TARGET_ID = "222222222222222222";

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

let nextId = 1;

/** Nickname-type entries scoped to `GUILD_ID`, matching `groupNameHistory`'s filter. */
function makeNicknameEntry(
  value: string | null,
  recordedAt: Date,
): UserNameHistoryEntry {
  return {
    id: nextId++,
    userId: BigInt(TARGET_ID),
    nameType: "nickname",
    guildId: BigInt(GUILD_ID),
    value,
    recordedAt,
  } as UserNameHistoryEntry;
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
  }

  walk(container.toJSON() as unknown as Record<string, unknown>);
  return texts;
}

function render(
  history: UserNameHistoryEntry[],
  nickname: string | null,
): string[] {
  const data: ModViewResult = {
    userInfo,
    history: {
      userInfo,
      moderationHistory: [],
      totalCases: 0,
      linkedIdentity: null,
    },
    lookup: null,
    names: { userInfo, history, eligibilityDenied: false },
    identity: null,
    standing: null,
  };

  const options: ModViewTabContentOptions = {
    data,
    disabled: false,
    // Username/globalName never come into play here — every fixture is a
    // nickname entry, so only `member.nickname` acts as the live value.
    user: {
      id: TARGET_ID,
      username: "no-username-changes",
      globalName: null,
    } as unknown as User,
    member: { nickname } as unknown as GuildMember,
    guildId: GUILD_ID,
    emojis,
  };

  const container = new ContainerBuilder();
  addNamesTabContent(container, options);
  return extractTextContents(container);
}

/**
 * All three groups (Username, Display Name, Nickname) render into a single
 * joined Text Display, and `options.user.username` is never null for a real
 * Discord user — the Username group's live value therefore always
 * synthesizes its own `current` row. Slice out just the Nickname group
 * (always last, per `NamesTabBuilder`'s `groups` array) so these tests only
 * see rows relevant to the nickname fixtures they set up.
 */
function nicknameLines(texts: string[]): string[] {
  const block = texts.find((t) => t.includes("Nickname (this server)"));
  if (!block) {
    throw new Error("no Nickname block rendered");
  }
  const lines = block.split("\n");
  const start = lines.findIndex((l) =>
    l.startsWith("**Nickname (this server)**"),
  );
  return lines.slice(start);
}

function countCurrentMarkers(text: string): number {
  return (text.match(/ · current/g) ?? []).length;
}

const OLDEST = new Date("2024-01-01T00:00:00.000Z");
const MIDDLE = new Date("2024-06-01T00:00:00.000Z");
const NEWEST = new Date("2024-12-01T00:00:00.000Z");

describe("NamesTabBuilder — current-value marking", () => {
  it("marks the recorded row matching the live nickname as current", () => {
    const history = [
      makeNicknameEntry("NewNick", NEWEST),
      makeNicknameEntry("OldNick", OLDEST),
    ];

    const lines = nicknameLines(render(history, "NewNick"));

    expect(lines[1]).toContain("`NewNick` · current");
    expect(lines[2]).not.toContain("current");
    expect(countCurrentMarkers(lines.join("\n"))).toBe(1);
  });

  it("synthesizes an unobserved live nickname as the group's top row", () => {
    const history = [makeNicknameEntry("PastNick", OLDEST)];

    const lines = nicknameLines(render(history, "LiveNick"));

    // labelLine, synthesized row, then the one recorded row.
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe("`LiveNick` · current");
    expect(lines[2]).not.toContain("current");
    expect(countCurrentMarkers(lines.join("\n"))).toBe(1);
  });

  it("marks exactly one row as current even when several rows share the live null value", () => {
    // Member had a nickname, removed it, set another, removed it again —
    // newest-first history has two `(removed)` rows and the live value is
    // also null. Only the newest removal may read as "current"; a bug here
    // previously marked every null-valued row as current.
    const history = [
      makeNicknameEntry(null, NEWEST), // most recent: cleared
      makeNicknameEntry("SecondNick", MIDDLE),
      makeNicknameEntry(null, OLDEST), // an earlier clearing
    ];

    const lines = nicknameLines(render(history, null));

    expect(lines).toHaveLength(4); // label + 3 entries, no synthesis (null already matched)
    expect(lines[1]).toStartWith("(removed) · current");
    expect(lines[2]).not.toContain("current");
    expect(lines[3]).toStartWith("(removed)");
    expect(lines[3]).not.toContain("current");
    expect(countCurrentMarkers(lines.join("\n"))).toBe(1);
  });

  it("does not mark any nickname row current when the live value matches nothing and is falsy", () => {
    // Falsy current value with no matching removed row: nothing to mark,
    // nothing synthesized (per `buildRows`, only a truthy `currentValue`
    // synthesizes a row).
    const history = [makeNicknameEntry("SomeNick", NEWEST)];

    const lines = nicknameLines(render(history, null));
    expect(countCurrentMarkers(lines.join("\n"))).toBe(0);
  });
});

describe("NamesTabBuilder — singular/plural counts", () => {
  // The scope block counts actually-recorded changes only — never the
  // synthesized "unobserved live value" row buildRows inserts when a live
  // value has no matching history, so this stays 0 even though the live
  // (non-null) username still renders a synthesized current row below.
  it("uses the plural noun in the scope block when there are zero recorded name changes", () => {
    const texts = render([], null);

    expect(texts[0]).toBe("-# 0 name changes");
  });

  it("uses the singular noun in the scope block when there is exactly one recorded name change", () => {
    const history = [makeNicknameEntry("SomeNick", OLDEST)];
    const texts = render(history, null);

    expect(texts[0]).toBe("-# 1 name change");
  });
});
