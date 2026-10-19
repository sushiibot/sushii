import { describe, expect, it } from "bun:test";

import { REP_INCREMENT } from "../constants";
import {
  calculateStreak,
  getNextStreakMilestone,
  getStreakMultiplier,
  rollRepAmount,
} from "./Streak";

const now = new Date("2026-10-18T05:00:00Z");

describe("calculateStreak", () => {
  it("starts at 1 for first use", () => {
    const result = calculateStreak(null, 0, now);

    expect(result.streak).toBe(1);
    expect(result.brokenStreak).toBeNull();
  });

  it("keeps the streak on the same UTC day", () => {
    const result = calculateStreak(new Date("2026-10-18T00:30:00Z"), 4, now);

    expect(result.streak).toBe(4);
  });

  it("starts existing users with no streak at 1 on the same UTC day", () => {
    const result = calculateStreak(new Date("2026-10-18T00:30:00Z"), 0, now);

    expect(result.streak).toBe(1);
  });

  it("extends the streak on the next UTC day, even under 24h later", () => {
    const result = calculateStreak(new Date("2026-10-17T23:00:00Z"), 4, now);

    expect(result.streak).toBe(5);
    expect(result.brokenStreak).toBeNull();
  });

  it("extends the streak at the end of the next UTC day", () => {
    const result = calculateStreak(
      new Date("2026-10-17T00:00:00Z"),
      4,
      new Date("2026-10-18T23:59:59Z"),
    );

    expect(result.streak).toBe(5);
  });

  it("resets after a missed UTC day and reports the lost streak", () => {
    const result = calculateStreak(new Date("2026-10-16T23:59:59Z"), 9, now);

    expect(result.streak).toBe(1);
    expect(result.brokenStreak).toBe(9);
  });

  it("does not report a lost 1 day streak", () => {
    const result = calculateStreak(new Date("2026-10-01T12:00:00Z"), 1, now);

    expect(result.streak).toBe(1);
    expect(result.brokenStreak).toBeNull();
  });
});

describe("getStreakMultiplier", () => {
  it("gives no bonus before a week", () => {
    expect(getStreakMultiplier(0)).toBe(1);
    expect(getStreakMultiplier(1)).toBe(1);
    expect(getStreakMultiplier(6)).toBe(1);
  });

  it("steps up at each milestone and holds between them", () => {
    expect(getStreakMultiplier(7)).toBe(1.1);
    expect(getStreakMultiplier(29)).toBe(1.1);
    expect(getStreakMultiplier(30)).toBe(1.25);
    expect(getStreakMultiplier(90)).toBe(1.5);
    expect(getStreakMultiplier(180)).toBe(1.75);
  });

  it("caps at 2x from a year", () => {
    expect(getStreakMultiplier(365)).toBe(2);
    expect(getStreakMultiplier(1000)).toBe(2);
  });
});

describe("getNextStreakMilestone", () => {
  it("returns the next milestone above the streak", () => {
    expect(getNextStreakMilestone(1)?.days).toBe(7);
    expect(getNextStreakMilestone(7)?.days).toBe(30);
    expect(getNextStreakMilestone(364)?.days).toBe(365);
  });

  it("returns null at the cap", () => {
    expect(getNextStreakMilestone(365)).toBeNull();
  });
});

describe("rollRepAmount", () => {
  it("gives a bonus rep when the roll is under the multiplier's fraction", () => {
    expect(rollRepAmount(1.3, 0.29)).toBe(REP_INCREMENT * 2);
    expect(rollRepAmount(1.3, 0.31)).toBe(REP_INCREMENT);
  });

  it("always gives a bonus at 2x", () => {
    expect(rollRepAmount(2, 0.999)).toBe(REP_INCREMENT * 2);
  });

  it("never gives a bonus without a multiplier", () => {
    expect(rollRepAmount(1, 0)).toBe(REP_INCREMENT);
  });
});
