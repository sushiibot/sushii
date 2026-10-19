import { describe, expect, it } from "bun:test";

import { REP_INCREMENT, STREAK_MULTIPLIER_CAP } from "../constants";
import { calculateStreak, getStreakMultiplier, rollRepAmount } from "./Streak";

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

  it("starts at 1.1x and adds 0.1 each time the streak doubles", () => {
    expect(getStreakMultiplier(7)).toBeCloseTo(1.1);
    expect(getStreakMultiplier(14)).toBeCloseTo(1.2);
    expect(getStreakMultiplier(28)).toBeCloseTo(1.3);
    expect(getStreakMultiplier(56)).toBeCloseTo(1.4);
  });

  it("caps at the max multiplier", () => {
    expect(getStreakMultiplier(112)).toBe(STREAK_MULTIPLIER_CAP);
    expect(getStreakMultiplier(1000)).toBe(STREAK_MULTIPLIER_CAP);
  });
});

describe("rollRepAmount", () => {
  it("gives a bonus rep when the roll is under the multiplier's fraction", () => {
    expect(rollRepAmount(1.3, 0.29)).toBe(REP_INCREMENT * 2);
    expect(rollRepAmount(1.3, 0.31)).toBe(REP_INCREMENT);
  });

  it("never gives a bonus without a multiplier", () => {
    expect(rollRepAmount(1, 0)).toBe(REP_INCREMENT);
  });
});
