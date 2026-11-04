import { describe, expect, it } from "bun:test";

import type { EmojiMap } from "@/features/bot-emojis";
import { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import {
  REASON_MAX_LENGTH,
  Reason,
} from "@/features/moderation/shared/domain/value-objects/Reason";
import { reasonDelivery } from "@/features/moderation/shared/presentation/proof/reasonBlock";
import {
  TAB_CONTENT_CHAR_BUDGET,
  chunkItems,
} from "@/shared/presentation/packLines";
import { makeModerationCase } from "@/test/fixtures/moderationCase";

import { HISTORY_ACTION_EMOJIS, formatModerationCase } from "./HistoryView";

const GUILD_ID = "111111111111111111";
const USER_A = "222222222222222222";
const USER_B = "333333333333333333";

const emojis = Object.fromEntries(
  HISTORY_ACTION_EMOJIS.map((name) => [name, `:${name}:`]),
) as EmojiMap<typeof HISTORY_ACTION_EMOJIS>;

function makeCase(userId: string, caseId: string) {
  return makeModerationCase({
    guildId: GUILD_ID,
    caseId,
    userId,
    executorId: USER_A,
  });
}

function makeReasonCase(
  reason: string,
  actionType: ActionType = ActionType.Warn,
) {
  return ModerationCase.create(
    GUILD_ID,
    "1",
    actionType,
    USER_A,
    "TestUser#0001",
    USER_B,
    Reason.create(reason).unwrap(),
  );
}

/** Exercises `chunkItems` the same way `buildHistoryTabPages` does, without pulling in the mod-view module. */
function buildPages(
  moderationHistory: ModerationCase[],
  showTargetMention: boolean,
): ModerationCase[][] {
  return chunkItems(moderationHistory, (c) =>
    formatModerationCase(c, emojis, showTargetMention),
  );
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

  it("quotes a delivered reason with no emoji", () => {
    const c = makeReasonCase("Spamming invite links").withDMResult({
      channelId: "1",
      messageId: "2",
    });

    const line = formatModerationCase(c, emojis);

    expect(line).toContain("\n> Spamming invite links");
    expect(line).not.toContain(":additional_message:");
    expect(line).not.toContain("Not sent");
  });

  it("marks a reason that wasn't sent, with why", () => {
    const c = makeReasonCase("Ignoring mods", ActionType.Kick).withDMIntent(
      false,
      "guild_default",
    );

    const line = formatModerationCase(c, emojis);

    expect(line).toContain(
      "\n> Ignoring mods\n> -# Not sent: kick DMs are off",
    );
  });

  it("marks a failed DM as not sent", () => {
    const c = makeReasonCase("spam").withDMResult({
      error: "Cannot send messages to this user",
      failureReason: "user_blocked",
    });

    expect(formatModerationCase(c, emojis)).toContain(
      "\n> spam\n> -# Not sent: DM failed: they have DMs off or blocked sushii",
    );
  });

  it("treats a deleted DM as not sent", () => {
    const c = makeReasonCase("spam")
      .withDMResult({ channelId: "1", messageId: "2" })
      .withDmDeleted(USER_B, new Date());

    expect(formatModerationCase(c, emojis)).toContain(
      `\n> spam\n> -# Not sent: DM deleted by <@${USER_B}>`,
    );
  });

  it("omits the not-sent line when the cause wasn't recorded", () => {
    const line = formatModerationCase(makeReasonCase("spam"), emojis);

    expect(line).toMatch(/\n> spam$/);
    expect(line).not.toContain("Not sent");
  });

  it("quotes a note's text plainly and never says not sent", () => {
    const line = formatModerationCase(
      makeReasonCase("Possible alt", ActionType.Note),
      emojis,
    );

    expect(line).toMatch(/\n> Possible alt$/);
    expect(line).not.toContain("Not sent");
  });

  it("shows proof counts, and files only when there are any", () => {
    const c = makeReasonCase("spam");

    expect(
      formatModerationCase(c, emojis, false, false, { entries: 3, files: 2 }),
    ).toContain("\n> -# :lock: 3 proof · :attachment: 2 files");
    expect(
      formatModerationCase(c, emojis, false, false, { entries: 1, files: 0 }),
    ).toMatch(/> -# :lock: 1 proof$/);
    expect(formatModerationCase(c, emojis)).not.toContain("proof");
  });

  it("no longer counts legacy attachments", () => {
    const c = ModerationCase.create(
      GUILD_ID,
      "1",
      ActionType.Warn,
      USER_A,
      "TestUser#0001",
      USER_A,
      null,
      undefined,
      ["https://cdn.discordapp.com/attachments/1/2/a.png"],
    );

    expect(formatModerationCase(c, emojis)).not.toContain("attachment");
  });

  it("never clips a max-length reason with real-length emojis", () => {
    const realEmojis = Object.fromEntries(
      HISTORY_ACTION_EMOJIS.map((name) => [
        name,
        `<:${name}:1234567890123456789>`,
      ]),
    ) as EmojiMap<typeof HISTORY_ACTION_EMOJIS>;
    const words = "Spamming invite links in general after two warnings. ";
    const reason = words.repeat(60).slice(0, REASON_MAX_LENGTH);
    const c = makeReasonCase(reason).withDMIntent(false, "executor_no");

    const line = formatModerationCase(c, realEmojis, true, true, {
      entries: 10,
      files: 10,
    });

    expect(line).toContain(reason);
    expect(line).not.toContain("Too long");
    expect(line).toContain("Not sent: the mod chose no DM");
  });

  it("falls back to a pointer for a reason too newline-heavy to fit", () => {
    const hugeReason = "a\n".repeat(REASON_MAX_LENGTH / 2);
    const c = makeReasonCase(hugeReason).withDMIntent(false, "executor_no");

    const line = formatModerationCase(c, emojis, false, false, {
      entries: 1,
      files: 1,
    });

    expect(line.length).toBeLessThanOrEqual(TAB_CONTENT_CHAR_BUDGET);
    expect(line).toContain("`#1`");
    expect(line).toContain(
      "\n> Too long to show here. Open it from History → View case.\n> -# Not sent: the mod chose no DM",
    );
    expect(line).toContain(":lock: 1 proof");
  });

  it("shows an oversized note's pointer plainly, with no not-sent line", () => {
    const c = makeReasonCase(
      "a\n".repeat(REASON_MAX_LENGTH / 2),
      ActionType.Note,
    );

    const line = formatModerationCase(c, emojis);

    expect(line).toMatch(
      /\n> Too long to show here\. Open it from History → View case\.$/,
    );
    expect(line).not.toContain("Not sent");
  });

  it("shows a delivered reason's pointer plainly", () => {
    const c = makeReasonCase("a\n".repeat(REASON_MAX_LENGTH / 2)).withDMResult({
      channelId: "1",
      messageId: "2",
    });

    const line = formatModerationCase(c, emojis);

    expect(line).toMatch(
      /\n> Too long to show here\. Open it from History → View case\.$/,
    );
  });
});

describe("reasonDelivery", () => {
  it("is sent only for a live DM", () => {
    expect(
      reasonDelivery(
        makeReasonCase("x").withDMResult({ channelId: "1", messageId: "2" }),
      ),
    ).toEqual({ sent: true });
  });

  it("explains a DM skipped because the user left", () => {
    expect(
      reasonDelivery(
        makeReasonCase("x").withDMIntent(true, "unknown", "user_not_in_guild"),
      ),
    ).toEqual({ sent: false, why: "they weren't in the server" });
  });

  it("says the DM failed when no failure reason was recorded", () => {
    expect(
      reasonDelivery(makeReasonCase("x").withDMResult({ error: "boom" })),
    ).toEqual({ sent: false, why: "DM failed: Discord returned an error" });
  });

  it("says the DM was deleted when no deleter was recorded", () => {
    expect(
      reasonDelivery(
        makeReasonCase("x")
          .withDMResult({ channelId: "1", messageId: "2" })
          .withDmDeleted(),
      ),
    ).toEqual({ sent: false, why: "DM deleted" });
  });

  it("has no cause for actions that never DM", () => {
    expect(reasonDelivery(makeReasonCase("x", ActionType.BanRemove))).toEqual({
      sent: false,
      why: null,
    });
  });
});

describe("chunkItems (via formatModerationCase)", () => {
  it("packs many short cases onto a single page", () => {
    const history = Array.from({ length: 30 }, (_, i) =>
      makeCase(USER_A, String(i + 1)),
    );

    const pages = buildPages(history, false);

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

    const pages = buildPages(history, false);

    // 4 max-length (1024-char) reasons don't fit in one 3600-char-budget
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

    const pages = buildPages(history, false);

    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(1);
  });

  it("returns no pages for empty history", () => {
    expect(buildPages([], false)).toHaveLength(0);
  });
});
