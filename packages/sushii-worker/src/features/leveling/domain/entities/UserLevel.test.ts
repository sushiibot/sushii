import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { UserLevel } from "./UserLevel";

function makeLevel(xp: number, lastMsg: Date): UserLevel {
  return new UserLevel("user", "guild", xp, xp, xp, xp, lastMsg);
}

describe("UserLevel", () => {
  describe("addXp level reporting", () => {
    it("reflects the new level immediately after crossing a threshold", () => {
      // 95 XP is level 1, 100 XP is level 2
      const level = makeLevel(95, new Date("2026-01-01T00:00:00Z"));
      expect(level.getCurrentLevel()).toBe(1);

      const oldLevel = level.addXp(5, new Date("2026-01-01T00:05:00Z"));

      expect(oldLevel).toBe(1);
      expect(level.getAllTimeXp()).toBe(100);
      expect(level.getTotalXp().getNumericValue()).toBe(100);
      expect(level.getCurrentLevel()).toBe(2);
      expect(level.getLevelProgress().level).toBe(2);
      expect(level.getLevelProgress().nextLevelXpProgress).toBe(0);
    });

    it("does not add XP within the cooldown window", () => {
      const lastMsg = new Date("2026-01-01T00:00:00Z");
      const level = makeLevel(95, lastMsg);

      const oldLevel = level.addXp(5, new Date("2026-01-01T00:00:30Z"));

      expect(oldLevel).toBe(1);
      expect(level.getAllTimeXp()).toBe(95);
      expect(level.getCurrentLevel()).toBe(1);
      expect(level.getLastMessageTime()).toEqual(lastMsg);
    });
  });

  describe("timeframe resets (UTC)", () => {
    let originalTz: string | undefined;

    beforeEach(() => {
      originalTz = process.env.TZ;
      // Non-UTC local zone to make sure resets do not depend on host timezone
      process.env.TZ = "America/Los_Angeles";
    });

    afterEach(() => {
      if (originalTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTz;
      }
    });

    it("resets day XP at UTC midnight", () => {
      // Both are Oct 18 in Los Angeles, but different UTC days
      const level = makeLevel(50, new Date("2026-10-18T23:00:00Z"));
      level.addXp(5, new Date("2026-10-19T01:00:00Z"));

      expect(level.getDayXp()).toBe(5);
    });

    it("does not reset day XP within the same UTC day", () => {
      // Different days in Los Angeles, same UTC day
      const level = makeLevel(50, new Date("2026-10-19T01:00:00Z"));
      level.addXp(5, new Date("2026-10-19T09:00:00Z"));

      expect(level.getDayXp()).toBe(55);
    });

    it("resets month XP at the UTC month boundary", () => {
      const level = makeLevel(50, new Date("2026-10-31T23:00:00Z"));
      level.addXp(5, new Date("2026-11-01T01:00:00Z"));

      expect(level.getMonthXp()).toBe(5);
      expect(level.getDayXp()).toBe(5);
    });

    it("does not reset month XP within the same UTC month", () => {
      const level = makeLevel(50, new Date("2026-11-01T01:00:00Z"));
      level.addXp(5, new Date("2026-11-01T09:00:00Z"));

      expect(level.getMonthXp()).toBe(55);
    });

    it("resets week XP at the UTC ISO week boundary (Monday)", () => {
      // Sunday 2026-10-18 -> Monday 2026-10-19 (UTC)
      const level = makeLevel(50, new Date("2026-10-18T23:00:00Z"));
      level.addXp(5, new Date("2026-10-19T01:00:00Z"));

      expect(level.getWeekXp()).toBe(5);
    });

    it("does not reset week XP across the new year within the same ISO week", () => {
      // 2026-12-31 (Thu) and 2027-01-01 (Fri) are both ISO week 53 of 2026
      const level = makeLevel(50, new Date("2026-12-31T12:00:00Z"));
      level.addXp(5, new Date("2027-01-01T12:00:00Z"));

      expect(level.getWeekXp()).toBe(55);
      expect(level.getDayXp()).toBe(5);
      expect(level.getMonthXp()).toBe(5);
    });
  });
});
