import { SnowflakeUtil } from "discord.js";

import type { ProofSuggestion } from "../domain/ProofSuggestion";

export const ACTION_TIME = new Date("2026-10-27T11:00:00.000Z");
export const GENERAL = "1029384756102938401";
export const MEDIA = "1029384756102938403";
export const ALERTS = "1029384756102938405";

/** A real snowflake for a time `minutesBefore` the action, so purge windows can read it. */
export function messageIdAt(minutesBefore: number, increment = 0): string {
  return SnowflakeUtil.generate({
    timestamp: ACTION_TIME.getTime() - minutesBefore * 60_000,
    increment: BigInt(increment),
  }).toString();
}

function at(minutesBefore: number): Date {
  return new Date(ACTION_TIME.getTime() - minutesBefore * 60_000);
}

export function automodSuggestion(
  overrides: Partial<ProofSuggestion> = {},
): ProofSuggestion {
  return {
    kind: "automod",
    channelId: ALERTS,
    blockedInChannelId: GENERAL,
    messageIds: [messageIdAt(2, 1)],
    totalInWindow: 1,
    firstAt: at(2),
    lastAt: at(2),
    snippet: "FREE NITRO 🎁 discord\\-nitro.gift/claim",
    ruleName: "Scam links",
    ...overrides,
  };
}

export function deletedSuggestion(
  overrides: Partial<ProofSuggestion> = {},
): ProofSuggestion {
  const ids = [7, 5, 3, 1].map((m, i) => messageIdAt(m, i + 10));
  return {
    kind: "deleted",
    channelId: GENERAL,
    messageIds: ids,
    totalInWindow: 4,
    firstAt: at(7),
    lastAt: at(1),
    snippet: "secret deleted spam text",
    deletedCount: 4,
    ...overrides,
  };
}

export function recentSuggestion(
  overrides: Partial<ProofSuggestion> = {},
): ProofSuggestion {
  const ids = [130, 120].map((m, i) => messageIdAt(m, i + 20));
  return {
    kind: "recent",
    channelId: MEDIA,
    messageIds: ids,
    totalInWindow: 2,
    firstAt: at(130),
    lastAt: at(120),
    snippet: "anyone want free nitro? dm me",
    deletedCount: 0,
    ...overrides,
  };
}
