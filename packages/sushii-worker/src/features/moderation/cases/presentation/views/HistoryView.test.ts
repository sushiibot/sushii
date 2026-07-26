import { describe, expect, it } from "bun:test";

import type { AltIdentityWithMembers } from "@/features/alt-accounts/domain/types";
import type { EmojiMap } from "@/features/bot-emojis";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import { makeAltIdentity } from "@/test/fixtures/altIdentity";
import { makeModerationCase } from "@/test/fixtures/moderationCase";

import type { UserHistoryResult } from "../../application/HistoryUserService";
import {
  HISTORY_ACTION_EMOJIS,
  buildHistoryPageContainer,
  buildHistoryPages,
  buildUserHistoryContextEmbed,
  formatModerationCase,
  spansMultipleUsers,
} from "./HistoryView";

function getContainerText(container: { toJSON: () => unknown }): string {
  const texts: string[] = [];

  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") {
      return;
    }

    if ("content" in node && typeof (node as { content?: unknown }).content === "string") {
      texts.push((node as { content: string }).content);
    }

    if (
      "components" in node &&
      Array.isArray((node as { components?: unknown }).components)
    ) {
      for (const child of (node as { components: unknown[] }).components) {
        walk(child);
      }
    }
  };

  walk(container.toJSON());
  return texts.join("\n");
}

const GUILD_ID = "111111111111111111";
const USER_A = "222222222222222222";
const USER_B = "333333333333333333";

const emojis = Object.fromEntries(
  HISTORY_ACTION_EMOJIS.map((name) => [name, `:${name}:`]),
) as EmojiMap<typeof HISTORY_ACTION_EMOJIS>;

const fakeTargetUser = {
  id: USER_A,
  displayName: "user",
  tag: "user#0000",
  createdTimestamp: Date.parse("2020-01-01T00:00:00.000Z"),
  displayAvatarURL: () => "https://example.com/avatar.png",
} as never;

function makeCase(userId: string, caseId: string) {
  return makeModerationCase({
    guildId: GUILD_ID,
    caseId,
    userId,
    executorId: USER_A,
  });
}

function makeIdentity(memberIds: string[]) {
  return makeAltIdentity({ guildId: GUILD_ID, memberIds, linkedBy: USER_A });
}

function makeHistoryResult(
  moderationHistory: ModerationCase[],
  linkedIdentity: AltIdentityWithMembers | null,
): UserHistoryResult {
  return {
    userInfo: {
      id: USER_A,
      username: "user",
      avatarURL: "https://example.com/avatar.png",
      joinedAt: null,
      isBot: false,
    },
    moderationHistory,
    totalCases: moderationHistory.length,
    linkedIdentity,
  };
}

describe("formatModerationCase", () => {
  it("omits the target mention by default", () => {
    const line = formatModerationCase(makeCase(USER_A, "1"), emojis);
    expect(line).not.toContain("on <@");
  });

  it("includes the target mention when showTargetMention is true", () => {
    const line = formatModerationCase(makeCase(USER_A, "1"), emojis, true);
    expect(line).toContain(`on <@${USER_A}>`);
  });

  it("always labels the executor mention as 'by', never a bare mention", () => {
    // target is USER_B, executor is USER_A (see makeCase) — distinct so the
    // "by" label can't accidentally match the target mention instead.
    const line = formatModerationCase(makeCase(USER_B, "1"), emojis, true);
    expect(line).toContain(`by <@${USER_A}>`);
    expect(line).toContain(`on <@${USER_B}>`);
  });
});

describe("buildUserHistoryContextEmbed", () => {
  it("shows the 3 most recent cases newest-first, not the oldest 3", () => {
    // moderationHistory arrives oldest-first (ascending case ID), matching
    // the repository's ordering.
    const history = [
      makeCase(USER_A, "1"),
      makeCase(USER_A, "2"),
      makeCase(USER_A, "3"),
      makeCase(USER_A, "4"),
      makeCase(USER_A, "5"),
    ];

    const embed = buildUserHistoryContextEmbed(
      { id: USER_A } as never,
      null,
      makeHistoryResult(history, null),
      emojis,
    );

    const description = embed.data.description ?? "";
    const case5Index = description.indexOf("#5");
    const case4Index = description.indexOf("#4");
    const case3Index = description.indexOf("#3");

    expect(description).toContain("#5");
    expect(description).toContain("#4");
    expect(description).toContain("#3");
    expect(description).not.toContain("#1");
    expect(description).not.toContain("#2");
    // Newest case shown first.
    expect(case5Index).toBeLessThan(case4Index);
    expect(case4Index).toBeLessThan(case3Index);
  });

  it("does not tag the target when the merged identity has no cases for other members", () => {
    const history = [makeCase(USER_A, "1")];
    const identity = makeIdentity([USER_A, USER_B]);

    const embed = buildUserHistoryContextEmbed(
      { id: USER_A } as never,
      null,
      makeHistoryResult(history, identity),
      emojis,
    );

    expect(embed.data.description ?? "").not.toContain("on <@");
  });

  it("tags each case with its target when cases span multiple linked accounts", () => {
    const history = [makeCase(USER_A, "1"), makeCase(USER_B, "2")];
    const identity = makeIdentity([USER_A, USER_B]);

    const embed = buildUserHistoryContextEmbed(
      { id: USER_A } as never,
      null,
      makeHistoryResult(history, identity),
      emojis,
    );

    const description = embed.data.description ?? "";
    expect(description).toContain(`on <@${USER_A}>`);
    expect(description).toContain(`on <@${USER_B}>`);
  });

  it("adds a merged-accounts footer only when the identity has more than one member", () => {
    const history = [makeCase(USER_A, "1")];

    const withoutIdentity = buildUserHistoryContextEmbed(
      { id: USER_A } as never,
      null,
      makeHistoryResult(history, null),
      emojis,
    );
    expect(withoutIdentity.data.footer?.text ?? "").not.toContain("Merged");

    const withIdentity = buildUserHistoryContextEmbed(
      { id: USER_A } as never,
      null,
      makeHistoryResult(history, makeIdentity([USER_A, USER_B])),
      emojis,
    );
    expect(withIdentity.data.footer?.text ?? "").toContain(
      "Merged across 2 linked accounts",
    );
  });
});

describe("buildHistoryPageContainer", () => {
  it("shows both absolute and relative account-created timestamps", () => {
    const history = [makeCase(USER_A, "1")];
    const historyResult = makeHistoryResult(history, null);

    const container = buildHistoryPageContainer(
      fakeTargetUser,
      null,
      historyResult,
      history,
      emojis,
      spansMultipleUsers(history),
      null,
      false,
    );

    const text = getContainerText(container);
    expect(text).toContain(":F>");
    expect(text).toContain(":R>");
  });

  it("has no merged banner when there is no linked identity", () => {
    const history = [makeCase(USER_A, "1")];
    const historyResult = makeHistoryResult(history, null);

    const container = buildHistoryPageContainer(
      fakeTargetUser,
      null,
      historyResult,
      history,
      emojis,
      spansMultipleUsers(history),
      null,
      false,
    );

    expect(getContainerText(container)).not.toContain("Merged history");
  });

  it("adds a merged-history banner when the identity has multiple members", () => {
    const history = [makeCase(USER_A, "1"), makeCase(USER_B, "2")];
    const identity = makeIdentity([USER_A, USER_B]);
    const historyResult = makeHistoryResult(history, identity);

    const container = buildHistoryPageContainer(
      fakeTargetUser,
      null,
      historyResult,
      history,
      emojis,
      spansMultipleUsers(history),
      null,
      false,
    );

    const text = getContainerText(container);
    expect(text).toContain("**Merged history for 2 linked alt accounts**");
    expect(text).toContain(`<@${USER_A}> <@${USER_B}>`);
    expect(text).toContain("-# use `/alts` to manage alts");

    // The merged-accounts block sits below the summary, not in the header.
    expect(text.indexOf("Merged history")).toBeGreaterThan(
      text.indexOf("**Summary**"),
    );
  });

  it("tags each case with its target when cases span multiple linked accounts", () => {
    const history = [makeCase(USER_A, "1"), makeCase(USER_B, "2")];
    const identity = makeIdentity([USER_A, USER_B]);
    const historyResult = makeHistoryResult(history, identity);

    const container = buildHistoryPageContainer(
      fakeTargetUser,
      null,
      historyResult,
      history,
      emojis,
      spansMultipleUsers(history),
      null,
      false,
    );

    const text = getContainerText(container);
    expect(text).toContain(`on <@${USER_A}>`);
    expect(text).toContain(`on <@${USER_B}>`);
  });

  it("bases the target-mention decision on the full history, not just the current page", () => {
    // Full history spans two accounts, but this page only has USER_A's case
    // — the target should still be tagged, since another page has USER_B.
    const history = [makeCase(USER_A, "1"), makeCase(USER_B, "2")];
    const identity = makeIdentity([USER_A, USER_B]);
    const historyResult = makeHistoryResult(history, identity);

    const container = buildHistoryPageContainer(
      fakeTargetUser,
      null,
      historyResult,
      [history[0]],
      emojis,
      spansMultipleUsers(history),
      null,
      false,
    );

    expect(getContainerText(container)).toContain(`on <@${USER_A}>`);
  });

  it("shows a summary of the full history, not just the current page", () => {
    const history = [makeCase(USER_A, "1"), makeCase(USER_A, "2")];
    const historyResult = makeHistoryResult(history, null);

    const container = buildHistoryPageContainer(
      fakeTargetUser,
      null,
      historyResult,
      [history[0]],
      emojis,
      spansMultipleUsers(history),
      null,
      false,
    );

    expect(getContainerText(container)).toContain("– 2");
  });

  it("shows an empty-page message when the current page has no cases", () => {
    const history = [makeCase(USER_A, "1")];
    const historyResult = makeHistoryResult(history, null);

    const container = buildHistoryPageContainer(
      fakeTargetUser,
      null,
      historyResult,
      [],
      emojis,
      spansMultipleUsers(history),
      null,
      false,
    );

    expect(getContainerText(container)).toContain(
      "No moderation cases found",
    );
  });

  it("reports the User ID subtext when there are no cases at all", () => {
    const historyResult = makeHistoryResult([], null);

    const container = buildHistoryPageContainer(
      fakeTargetUser,
      null,
      historyResult,
      [],
      emojis,
      false,
      null,
      false,
    );

    expect(getContainerText(container)).toContain(`User ID: ${USER_A}`);
  });
});

describe("buildHistoryPages", () => {
  it("packs many short cases onto a single page", () => {
    const history = Array.from({ length: 30 }, (_, i) =>
      makeCase(USER_A, String(i + 1)),
    );

    const pages = buildHistoryPages(history, emojis, false);

    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(30);
  });

  it("splits onto a new page instead of truncating a long reason", () => {
    const longReason = "a".repeat(1024);
    const history = Array.from({ length: 4 }, (_, i) =>
      makeModerationCase({
        guildId: GUILD_ID,
        caseId: String(i + 1),
        userId: USER_A,
        executorId: USER_A,
        reason: longReason,
      }),
    );

    const pages = buildHistoryPages(history, emojis, false);

    // 4 max-length (1024-char) reasons don't fit in one 3500-char-budget
    // page, but no case is ever dropped or shortened across however many
    // pages it takes.
    expect(pages.length).toBeGreaterThan(1);
    const allCases = pages.flat();
    expect(allCases).toHaveLength(4);
    for (const c of allCases) {
      expect(c.reason?.value).toBe(longReason);
    }
  });

  it("always keeps at least one case per page, even if it alone is large", () => {
    const longReason = "a".repeat(1024);
    const history = [
      makeModerationCase({
        guildId: GUILD_ID,
        caseId: "1",
        userId: USER_A,
        executorId: USER_A,
        reason: longReason,
      }),
    ];

    const pages = buildHistoryPages(history, emojis, false);

    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(1);
  });

  it("returns no pages for empty history", () => {
    expect(buildHistoryPages([], emojis, false)).toHaveLength(0);
  });
});
