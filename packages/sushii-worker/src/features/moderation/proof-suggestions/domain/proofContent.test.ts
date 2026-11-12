import { describe, expect, test } from "bun:test";

import { PROOF_CONTENT_MAX_LENGTH } from "@/features/moderation/shared/domain/entities/CaseProof";

import type { ProofSuggestion } from "./ProofSuggestion";
import { MAX_TARGET_MESSAGES } from "./ProofSuggestion";
import {
  fitProofContent,
  formatProofContent,
  messageUrl,
  toProofItems,
} from "./proofContent";
import type { ResolvedLink, ResolvedSuggestionLinks } from "./proofContent";

const GUILD = "100000000000000001";
const CHANNEL = "300000000000000001";
const LOG = "300000000000000009";

function suggestion(overrides: Partial<ProofSuggestion> = {}): ProofSuggestion {
  return {
    kind: "deleted",
    channelId: CHANNEL,
    messageIds: [],
    totalInWindow: 1,
    firstAt: new Date(0),
    lastAt: new Date(0),
    snippet: "secret text",
    ...overrides,
  };
}

function logLink(post: number, messageIds: string[]): ResolvedLink {
  const id = (900000000000000000n + BigInt(post)).toString();
  return {
    url: messageUrl(GUILD, LOG, id),
    source: "log",
    channelId: LOG,
    messageIds,
  };
}

function messageLink(id: string): ResolvedLink {
  return {
    url: messageUrl(GUILD, CHANNEL, id),
    source: "message",
    channelId: CHANNEL,
    messageIds: [id],
  };
}

function resolved(links: ResolvedLink[]): ResolvedSuggestionLinks {
  return { links, pending: [], skipped: [] };
}

describe("formatProofContent", () => {
  test("the engine cap fits every link even with maximum-length Discord snowflakes", () => {
    // Deduplication reads every saved URL, so engine-produced rows must never overflow.
    const snowflake = "18446744073709551615";
    const links = Array.from({ length: MAX_TARGET_MESSAGES }, (_, i) => ({
      url: messageUrl(
        snowflake,
        snowflake,
        (BigInt(snowflake) - BigInt(i)).toString(),
      ),
      source: i % 2 === 0 ? ("log" as const) : ("message" as const),
      channelId: snowflake,
      messageIds: [String(i)],
    }));
    for (const kind of ["recent", "deleted", "automod"] as const) {
      const content = formatProofContent(
        suggestion({
          kind,
          channelId: snowflake,
          blockedInChannelId: snowflake,
          ruleName: "😀".repeat(100),
        }),
        resolved(kind === "automod" ? links.slice(0, 1) : links),
      );
      expect(content?.length ?? Infinity).toBeLessThanOrEqual(
        PROOF_CONTENT_MAX_LENGTH,
      );
      expect(content).not.toContain(" more in ");
      for (const link of kind === "automod" ? links.slice(0, 1) : links) {
        expect(content).toContain(link.url);
      }
    }
  });
  test("deleted messages: emoji, label and space-separated links", () => {
    const content = formatProofContent(
      suggestion(),
      resolved([logLink(1, ["1", "2"]), logLink(2, ["3"])]),
    );

    expect(content).toBe(
      `🗑️ 3 deleted messages in <#${CHANNEL}> · ${messageUrl(GUILD, LOG, "900000000000000001")} ${messageUrl(GUILD, LOG, "900000000000000002")}`,
    );
  });

  test("never includes message content", () => {
    const content = formatProofContent(
      suggestion({ kind: "recent" }),
      resolved([messageLink("5")]),
    );
    expect(content).not.toContain("secret text");
    expect(content).toBe(
      `💬 1 message in <#${CHANNEL}> · ${messageUrl(GUILD, CHANNEL, "5")}`,
    );
  });

  test("recent with some deleted notes the deleted count", () => {
    const content = formatProofContent(
      suggestion({ kind: "recent" }),
      resolved([messageLink("5"), logLink(1, ["6", "7"])]),
    );
    expect(
      content?.startsWith(`💬 3 messages in <#${CHANNEL}> (2 deleted) · `),
    ).toBe(true);
  });

  test("automod names the rule and where it was blocked", () => {
    const content = formatProofContent(
      suggestion({
        kind: "automod",
        ruleName: "Block *invites*",
        blockedInChannelId: "300000000000000002",
      }),
      resolved([messageLink("8")]),
    );
    expect(content).toBe(
      `🤖 AutoMod alert: Block \\*invites\\* in <#300000000000000002> · ${messageUrl(GUILD, CHANNEL, "8")}`,
    );
  });

  test("more than 10 links: first + last + N more in the log channel", () => {
    const links = Array.from({ length: 14 }, (_, i) => logLink(i, [`${i}`]));
    const content = formatProofContent(suggestion(), resolved(links));

    expect(content).toBe(
      `🗑️ 14 deleted messages in <#${CHANNEL}> · ${links[0].url} ${links[13].url} +12 more in <#${LOG}>`,
    );
  });

  test("overflow names the log channel even when the second link is a live message", () => {
    const links = [
      messageLink("1"),
      messageLink("2"),
      ...Array.from({ length: 10 }, (_, i) => logLink(i, [`${i + 3}`])),
    ];
    const content = formatProofContent(
      suggestion({ kind: "recent" }),
      resolved(links),
    );

    expect(content).toEndWith(`+10 more in <#${LOG}>`);
  });

  test("overflow of live messages names their channel", () => {
    const links = Array.from({ length: 12 }, (_, i) => messageLink(`${i}`));
    const content = formatProofContent(
      suggestion({ kind: "recent" }),
      resolved(links),
    );

    expect(content).toEndWith(`+10 more in <#${CHANNEL}>`);
  });

  test("fitProofContent shortens the label, never a URL", () => {
    const url = messageUrl(GUILD, LOG, "900000000000000001");
    const links = `${url} +3 more in <#${LOG}>`;

    const content = fitProofContent("x".repeat(200), links, 150);
    expect(content).toHaveLength(150);
    expect(content).toEndWith(` · ${links}`);
    expect(content.startsWith("x".repeat(10))).toBe(true);

    expect(fitProofContent("label", links, 100)).toBe(url);
  });

  test("10 links with a long rule name stay under the limit", () => {
    const links = Array.from({ length: 10 }, (_, i) => logLink(i, [`${i}`]));
    const content = formatProofContent(
      suggestion({ kind: "automod", ruleName: "r".repeat(300) }),
      resolved(links),
    );

    expect(content).not.toBeNull();
    expect(content?.length ?? Infinity).toBeLessThanOrEqual(
      PROOF_CONTENT_MAX_LENGTH,
    );
    expect(content).toContain(links[9].url);
  });

  test("no links → no row", () => {
    expect(formatProofContent(suggestion(), resolved([]))).toBeNull();
  });
});

describe("toProofItems", () => {
  test("pairs suggestions with their links and drops empty ones", () => {
    const items = toProofItems(
      [suggestion(), suggestion({ kind: "recent" })],
      [resolved([]), resolved([messageLink("5")])],
    );
    expect(items).toEqual([
      {
        content: `💬 1 message in <#${CHANNEL}> · ${messageUrl(GUILD, CHANNEL, "5")}`,
      },
    ]);
  });
});
