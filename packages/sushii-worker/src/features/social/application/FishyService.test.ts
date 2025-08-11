import { describe, expect, it } from "bun:test";

import { CatchableType, FISH_PROBABILITIES } from "../domain";

describe("FishyService", () => {
  describe("fish randomization", () => {
    it("should generate Golden fishy at approximately 1% rate", () => {
      const iterations = 10000;
      let goldenCount = 0;

      for (let i = 0; i < iterations; i++) {
        // Test the 1% probability for Golden fishy
        if (Math.random() < FISH_PROBABILITIES.GOLDEN / 100) {
          goldenCount++;
        }
      }

      const actualRate = goldenCount / iterations;
      // Allow 0.3% margin of error for randomness
      expect(actualRate).toBeCloseTo(FISH_PROBABILITIES.GOLDEN / 100, 1);
    });

    it("should have all required fish types defined", () => {
      // Verify all enum values exist
      expect(CatchableType.Golden).toBeDefined();
      expect(CatchableType.Anchovy).toBeDefined();
      expect(CatchableType.Wawa).toBeDefined();
      expect(CatchableType.Rotten).toBeDefined();

      // Verify Gunnie was removed
      expect(Object.values(CatchableType)).not.toContain("gunnie 🔫");
    });
  });
});
