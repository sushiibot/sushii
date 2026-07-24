import { describe, expect, it } from "bun:test";

import type { AltIdentityWithMembers } from "@/features/alt-accounts/domain/types";
import type { EmojiMap } from "@/features/bot-emojis";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import { makeAltIdentity } from "@/test/fixtures/altIdentity";
import { makeModerationCase } from "@/test/fixtures/moderationCase";

import type { UserHistoryResult } from "../../application/HistoryUserService";
import {
  HISTORY_ACTION_EMOJIS,
  buildUserHistoryContextEmbed,
  buildUserHistoryEmbeds,
  formatModerationCase,
} from "./HistoryView";

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

describe("buildUserHistoryEmbeds", () => {
  it("has no merged banner or footer note when there is no linked identity", () => {
    const history = [makeCase(USER_A, "1")];

    const [embed] = buildUserHistoryEmbeds(
      fakeTargetUser,
      null,
      makeHistoryResult(history, null),
      emojis,
    );

    expect(embed.data.description ?? "").not.toContain("Merged history");
    expect(embed.data.footer?.text ?? "").not.toContain("merged");
  });

  it("adds a merged-history banner and footer note when the identity has multiple members", () => {
    const history = [makeCase(USER_A, "1"), makeCase(USER_B, "2")];
    const identity = makeIdentity([USER_A, USER_B]);

    const [embed] = buildUserHistoryEmbeds(
      fakeTargetUser,
      null,
      makeHistoryResult(history, identity),
      emojis,
    );

    expect(embed.data.description ?? "").toContain(
      "Merged history across 2 linked accounts",
    );
    expect(embed.data.footer?.text ?? "").toContain(
      "merged across 2 linked accounts",
    );
  });

  it("tags each case with its target when the merged cases span multiple accounts", () => {
    const history = [makeCase(USER_A, "1"), makeCase(USER_B, "2")];
    const identity = makeIdentity([USER_A, USER_B]);

    const [embed] = buildUserHistoryEmbeds(
      fakeTargetUser,
      null,
      makeHistoryResult(history, identity),
      emojis,
    );

    const description = embed.data.description ?? "";
    expect(description).toContain(`on <@${USER_A}>`);
    expect(description).toContain(`on <@${USER_B}>`);
  });

  it("still reports the User ID footer when there are no cases at all", () => {
    const [embed] = buildUserHistoryEmbeds(
      fakeTargetUser,
      null,
      makeHistoryResult([], null),
      emojis,
    );

    expect(embed.data.footer?.text ?? "").toContain(`User ID: ${USER_A}`);
  });
});
