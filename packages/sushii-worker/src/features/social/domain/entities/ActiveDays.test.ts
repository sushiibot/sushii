import { describe, expect, it } from "bun:test";

import { REP_INCREMENT } from "../constants";
import {
  countActiveDays,
  getActiveDaysMultiplier,
  recordActiveDay,
  rollRepAmount,
  utcDayNumber,
} from "./ActiveDays";

const now = new Date("2026-10-18T05:00:00Z");
const today = utcDayNumber(now);
const fullWindow = 2 ** 30 - 1;

describe("recordActiveDay", () => {
  it("starts with today on first use", () => {
    const result = recordActiveDay({ mask: 0, anchorDay: null }, now);

    expect(result).toMatchObject({
      mask: 1,
      anchorDay: today,
      activeDays: 1,
      isNewDay: true,
    });
  });

  it("does not count a second use on the same UTC day", () => {
    const result = recordActiveDay({ mask: 0b101, anchorDay: today }, now);

    expect(result).toMatchObject({
      mask: 0b101,
      anchorDay: today,
      activeDays: 2,
      isNewDay: false,
    });
  });

  it("counts the next UTC day, even under 24h later", () => {
    const result = recordActiveDay(
      { mask: 1, anchorDay: utcDayNumber(new Date("2026-10-17T23:00:00Z")) },
      now,
    );

    expect(result.mask).toBe(0b11);
    expect(result.isNewDay).toBe(true);
  });

  it("leaves missed days empty without resetting", () => {
    const result = recordActiveDay({ mask: 0b111, anchorDay: today - 3 }, now);

    expect(result.mask).toBe(0b111001);
    expect(result.activeDays).toBe(4);
  });

  it("drops days older than the window", () => {
    const result = recordActiveDay(
      { mask: fullWindow, anchorDay: today - 1 },
      now,
    );

    expect(result.activeDays).toBe(30);
  });

  it("keeps only the oldest day in range after a 29 day gap", () => {
    const result = recordActiveDay({ mask: 1, anchorDay: today - 29 }, now);

    expect(result.mask).toBe(2 ** 29 + 1);
    expect(result.activeDays).toBe(2);
  });

  it.each([30, 31, 32, 60])("starts fresh after a %i day gap", (gap) => {
    const result = recordActiveDay(
      { mask: fullWindow, anchorDay: today - gap },
      now,
    );

    expect(result.mask).toBe(1);
    expect(result.activeDays).toBe(1);
    expect(result.isNewDay).toBe(true);
  });

  it("does not move the window backwards on clock skew", () => {
    const result = recordActiveDay({ mask: 1, anchorDay: today + 1 }, now);

    expect(result.anchorDay).toBe(today + 1);
    expect(result.isNewDay).toBe(false);
  });
});

describe("countActiveDays", () => {
  it("ignores bits outside the window", () => {
    expect(countActiveDays(0)).toBe(0);
    expect(countActiveDays(fullWindow)).toBe(30);
    expect(countActiveDays(2 ** 30 + 1)).toBe(1);
  });
});

describe("getActiveDaysMultiplier", () => {
  it("scales linearly to a capped 1.5x", () => {
    expect(getActiveDaysMultiplier(0)).toBe(1);
    expect(getActiveDaysMultiplier(15)).toBe(1.25);
    expect(getActiveDaysMultiplier(30)).toBe(1.5);
    expect(getActiveDaysMultiplier(45)).toBe(1.5);
  });
});

describe("rollRepAmount", () => {
  it("doubles rep when the roll is under the bonus chance", () => {
    expect(rollRepAmount(1.3, 0.29)).toBe(REP_INCREMENT * 2);
    expect(rollRepAmount(1.3, 0.31)).toBe(REP_INCREMENT);
  });

  it("never doubles with no bonus", () => {
    expect(rollRepAmount(1, 0)).toBe(REP_INCREMENT);
  });
});
