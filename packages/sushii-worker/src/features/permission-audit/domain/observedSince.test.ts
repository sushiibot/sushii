import { describe, expect, test } from "bun:test";
import { AuditLogEvent } from "discord.js";

import { observedSince } from "./observedSince";

const NOW = new Date("2026-10-13T00:00:00Z");
const TRACKING = new Date("2026-10-10T00:00:00Z");

describe("observedSince", () => {
  test("no coverage yet means history starts now", () => {
    expect(observedSince(["BanMembers"], null, NOW).get("BanMembers")).toEqual(
      NOW,
    );
  });

  test("before backfill, history starts at tracking start", () => {
    const result = observedSince(
      ["BanMembers", "MentionEveryone"],
      { trackingStartedAt: TRACKING, backfilledAt: null, backfillCoverage: {} },
      NOW,
    );

    expect(result.get("BanMembers")).toEqual(TRACKING);
    expect(result.get("MentionEveryone")).toEqual(TRACKING);
  });

  test("after backfill, the least-covered action type wins", () => {
    const result = observedSince(
      ["BanMembers"],
      {
        trackingStartedAt: TRACKING,
        backfilledAt: NOW,
        backfillCoverage: {
          [AuditLogEvent.MemberBanAdd]: new Date("2026-08-29T00:00:00Z"),
          [AuditLogEvent.MemberBanRemove]: new Date("2026-09-20T00:00:00Z"),
        },
      },
      NOW,
    );

    expect(result.get("BanMembers")).toEqual(new Date("2026-09-20T00:00:00Z"));
  });

  test("message-only permissions keep the tracking start after backfill", () => {
    const result = observedSince(
      ["MentionEveryone"],
      { trackingStartedAt: TRACKING, backfilledAt: NOW, backfillCoverage: {} },
      NOW,
    );

    expect(result.get("MentionEveryone")).toEqual(TRACKING);
  });
});
