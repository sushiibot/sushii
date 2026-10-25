import { expect, test } from "bun:test";

import {
  COLLECTIBLES,
  RARITY_WEIGHTS,
  conditionSchema,
  fishingCondition,
  selectCollectible,
  weightedPick,
} from "./Catalog";

test("each shared twenty-hour block contains every condition exactly once", () => {
  for (let block = 20000; block < 20100; block++) {
    const dates = Array.from(
      { length: 5 },
      (_, i) => (block * 5 + i) * 4 * 3600000,
    );
    expect(
      new Set(dates.map((ms) => fishingCondition(new Date(ms)))).size,
    ).toBe(5);
    for (const ms of dates)
      expect(fishingCondition(new Date(ms + 1))).toBe(
        fishingCondition(new Date(ms)),
      );
  }
});

test("fixed tier boundaries and every item stay reachable in every condition", () => {
  for (const condition of conditionSchema.options) {
    let start = 0;
    for (const [rarity, weight] of Object.entries(RARITY_WEIGHTS)) {
      for (const roll of [start, start + weight - 1]) {
        let call = 0;
        expect(
          String(
            selectCollectible(condition, () => (call++ === 0 ? roll : 0))
              .rarity,
          ),
        ).toBe(rarity);
      }
      let offset = 0;
      for (const item of COLLECTIBLES.filter((i) => i.rarity === rarity)) {
        let call = 0;
        expect(
          selectCollectible(condition, () => (call++ === 0 ? start : offset))
            .id,
        ).toBe(item.id);
        offset += Math.round(
          item.baseWeight *
            (item.preferredCondition === condition
              ? item.conditionMultiplier
              : 1),
        );
      }
      start += weight;
    }
    expect(start).toBe(10000);
  }
});

test("weighted selection rejects invalid draws", () => {
  expect(() => weightedPick([1], [100], () => 100)).toThrow();
});
