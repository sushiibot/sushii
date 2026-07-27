import { describe, expect, it } from "bun:test";

import { makeAltIdentity } from "@/test/fixtures/altIdentity";

import type { LinkAccountsOutcome } from "../../application/LinkAccountsService";
import { buildLinkOutcomeContainer } from "./AltResponseView";

const USER_A = "222222222222222222";
const USER_B = "333333333333333333";
const USER_C = "444444444444444444";
const BOT_ID = "666666666666666666";

function makeOutcome(
  overrides: Partial<LinkAccountsOutcome> = {},
): LinkAccountsOutcome {
  return {
    identity: makeAltIdentity({ memberIds: [USER_A, USER_B] }),
    identityCreated: true,
    addedUserIds: [USER_A, USER_B],
    alreadyLinkedUserIds: [],
    mergedIdentityIds: [],
    keptNickname: null,
    adoptedNickname: null,
    discardedNicknames: [],
    skippedBotIds: [],
    ...overrides,
  };
}

function render(
  outcome: LinkAccountsOutcome,
  context: Partial<Parameters<typeof buildLinkOutcomeContainer>[1]> = {},
): string {
  const container = buildLinkOutcomeContainer(outcome, {
    primaryUserIds: [USER_A, USER_B],
    reason: null,
    invalidTokens: [],
    unresolvedIds: [],
    ...context,
  });

  return JSON.stringify(container.toJSON());
}

describe("buildLinkOutcomeContainer", () => {
  it("reports a newly created identity with its member count", () => {
    const text = render(makeOutcome());

    expect(text).toContain("**Linked** 2 accounts as a new identity.");
  });

  it("reports accounts added to an existing identity", () => {
    const text = render(
      makeOutcome({
        identityCreated: false,
        addedUserIds: [USER_C],
        alreadyLinkedUserIds: [USER_A, USER_B],
      }),
    );

    expect(text).toContain(`**Added** <@${USER_C}> to an existing identity.`);
  });

  it("reports an already-linked no-op", () => {
    const text = render(
      makeOutcome({
        identityCreated: false,
        addedUserIds: [],
        alreadyLinkedUserIds: [USER_A, USER_B],
      }),
    );

    expect(text).toContain("**already linked**");
  });

  it("reports a merge that also added accounts", () => {
    const text = render(
      makeOutcome({
        identityCreated: false,
        addedUserIds: [USER_C],
        mergedIdentityIds: [7, 9],
      }),
    );

    expect(text).toContain("**Merged** 3 identities into one.");
    expect(text).toContain(`Also added <@${USER_C}>.`);
  });

  it("lists every nickname dropped by a merge", () => {
    const text = render(
      makeOutcome({
        identityCreated: false,
        addedUserIds: [],
        mergedIdentityIds: [7, 9],
        keptNickname: "kept",
        discardedNicknames: ["dropped one", "dropped two"],
      }),
    );

    expect(text).toContain("Kept nickname **kept**");
    expect(text).toContain("**dropped one**, **dropped two**");
  });

  it("says a nickname was adopted rather than kept when the survivor had none", () => {
    const text = render(
      makeOutcome({
        identityCreated: false,
        addedUserIds: [],
        mergedIdentityIds: [7, 9],
        keptNickname: null,
        adoptedNickname: "second group",
        discardedNicknames: ["third group"],
      }),
    );

    expect(text).toContain(
      "Took the nickname **second group** from a merged identity",
    );
    expect(text).toContain("dropping **third group**");
    expect(text).not.toContain("Kept nickname");
  });

  it("still reports an adopted nickname when nothing else was dropped", () => {
    const text = render(
      makeOutcome({
        identityCreated: false,
        addedUserIds: [],
        mergedIdentityIds: [7],
        keptNickname: null,
        adoptedNickname: "only name",
        discardedNicknames: [],
      }),
    );

    expect(text).toContain("Took the nickname **only name**");
  });

  it("only caveats the reason when a merge saved nothing", () => {
    const mergeOnly = render(
      makeOutcome({
        identityCreated: false,
        addedUserIds: [],
        mergedIdentityIds: [7],
      }),
      { reason: "same person" },
    );
    const mergeWithAdd = render(
      makeOutcome({
        identityCreated: false,
        addedUserIds: [USER_C],
        mergedIdentityIds: [7],
      }),
      { reason: "same person" },
    );

    expect(mergeOnly).toContain("not saved");
    expect(mergeWithAdd).not.toContain("not saved");
  });

  it("notes skipped bots, unresolved IDs, and unrecognized entries", () => {
    const text = render(makeOutcome({ skippedBotIds: [BOT_ID] }), {
      unresolvedIds: [USER_C],
      invalidTokens: ["not-an-id"],
    });

    expect(text).toContain("Skipped 1 bot account(s)");
    expect(text).toContain("Couldn't find 1 account(s)");
    expect(text).toContain("Ignored 1 unrecognized entry");
  });

  it("caps echoed input so a pasted paragraph can't blow the text budget", () => {
    const garbage = Array.from({ length: 50 }, (_, i) =>
      `garbage-token-that-is-quite-long-${i}`,
    );

    const text = render(makeOutcome(), { invalidTokens: garbage });

    expect(text).toContain("Ignored 50 unrecognized entries");
    expect(text).toContain("and 45 more");
    expect(text.length).toBeLessThan(4000);
  });

  it("fits a long note and a large identity into one text display", () => {
    const memberIds = Array.from(
      { length: 200 },
      (_, i) => `7000000000000${String(i).padStart(5, "0")}`,
    );
    const addedUserIds = memberIds.slice(0, 23);

    const container = buildLinkOutcomeContainer(
      makeOutcome({
        identity: makeAltIdentity({ memberIds }),
        identityCreated: false,
        addedUserIds,
        mergedIdentityIds: [7, 9],
        keptNickname: "kept",
        discardedNicknames: ["dropped one", "dropped two"],
        skippedBotIds: [BOT_ID],
      }),
      {
        primaryUserIds: [USER_A, USER_B],
        reason: "x".repeat(400),
        invalidTokens: ["bad-token"],
        unresolvedIds: [USER_C],
      },
    );

    const content = (
      container.toJSON().components[0] as {
        components: { content: string }[];
      }
    ).components[0].content;

    expect(content.length).toBeLessThanOrEqual(4000);
    expect(content).toContain("**Merged** 3 identities into one.");
  });
});
