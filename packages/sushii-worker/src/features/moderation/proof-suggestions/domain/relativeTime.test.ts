import { expect, test } from "bun:test";

import { relativeTimeRange } from "./relativeTime";

const action = new Date("2026-11-10T18:37:00Z");
const before = (minutes: number) =>
  new Date(action.getTime() - minutes * 60_000);

test.each([
  [7, 7, "7m before"],
  [120, 120, "2h before"],
  [0, 0, "just before"],
  [0.99, 0.01, "just before"],
  [1, 1, "1m before"],
  [16, 5, "16–5m before"],
  [180, 120, "3–2h before"],
  [120, 5, "2h–5m before"],
  [1, 0, "in the 1m before"],
  [59, 0, "in the 59m before"],
  [59, 30, "59–30m before"],
  [-1, -2, "after"],
  [1, -1, "1m before–after"],
])("formats %s to %s minutes before the action", (first, last, expected) => {
  expect(relativeTimeRange(before(first), before(last), action)).toBe(expected);
});

test("rejects invalid dates", () => {
  expect(() => relativeTimeRange(new Date("invalid"), action, action)).toThrow(
    RangeError,
  );
});
