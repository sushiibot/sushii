import { expect, test } from "bun:test";

import {
  COLLECTIBLES,
  RARITY_PAYOUTS,
  RARITY_WEIGHTS,
  conditionSchema,
  fishingCondition,
  getCollectible,
  payoutFor,
  raritySchema,
  rollPayout,
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

test("payout rolls stay within the item's range inclusive", () => {
  for (const item of COLLECTIBLES) {
    const { min, max } = payoutFor(item);
    expect(rollPayout(item, () => 0)).toBe(min);
    expect(rollPayout(item, (n) => n - 1)).toBe(max);
  }
});

test("junk pays less than any real catch", () => {
  const spoon = payoutFor(getCollectible("spoon"));
  const lowestTier = Math.min(
    ...Object.values(RARITY_PAYOUTS).map((p) => p.min),
  );
  expect(spoon.max).toBeLessThan(lowestTier);
  expect(payoutFor(getCollectible("tyre"))).toEqual(spoon);
});

test("rarer tiers never pay less than the tier below", () => {
  const tiers = raritySchema.options.map((r) => RARITY_PAYOUTS[r]);
  for (let i = 1; i < tiers.length; i++) {
    expect(tiers[i].min).toBeGreaterThanOrEqual(tiers[i - 1].min);
    expect(tiers[i].max).toBeGreaterThan(tiers[i - 1].max);
  }
});

// The pre-collection payout table averaged about 25.5 fishies per catch.
test("expected payout per catch stays near the previous economy", () => {
  for (const condition of conditionSchema.options) {
    let expected = 0;
    for (const rarity of raritySchema.options) {
      const pool = COLLECTIBLES.filter((i) => i.rarity === rarity);
      const weights = pool.map(
        (i) =>
          i.baseWeight *
          (i.preferredCondition === condition ? i.conditionMultiplier : 1),
      );
      const total = weights.reduce((a, b) => a + b, 0);
      pool.forEach((item, idx) => {
        const { min, max } = payoutFor(item);
        expected +=
          (RARITY_WEIGHTS[rarity] / 10000) *
          (weights[idx] / total) *
          ((min + max) / 2);
      });
    }
    expect(expected).toBeGreaterThan(22);
    expect(expected).toBeLessThan(29);
  }
});
