import { describe, expect, test } from "bun:test";
import { calculateLevel, calculateLevelProgress } from "@/shared/domain/utils/LevelCalculations";

describe("Level calculations", () => {
  describe.each([
    {
      xp: 0,
      wantLevel: 1,
      wantNextLevelXpProgress: 0,
      wantNextLevelXpRequired: 100,
    },
    {
      xp: 100,
      wantLevel: 2,
      wantNextLevelXpProgress: 0,
      wantNextLevelXpRequired: 200,
    },
    {
      xp: 300,
      wantLevel: 3,
      wantNextLevelXpProgress: 0,
      wantNextLevelXpRequired: 300,
    },
    {
      xp: 300 + 150,
      wantLevel: 3,
      wantNextLevelXpProgress: 150, // This is current progress
      wantNextLevelXpRequired: 300, // Stays the same for total
    },
    {
      xp: 600,
      wantLevel: 4,
      wantNextLevelXpProgress: 0,
      wantNextLevelXpRequired: 400,
    },
    {
      xp: 4500,
      wantLevel: 10,
      wantNextLevelXpProgress: 0,
      wantNextLevelXpRequired: 1000,
    },
  ])(
    "Level calculations($xp XP)",
    ({ xp, wantLevel, wantNextLevelXpProgress, wantNextLevelXpRequired }) => {
      const levelProg = calculateLevelProgress(xp);

      test("getLevel", () => {
        const level = Number(calculateLevel(BigInt(xp)));

        expect(level).toEqual(wantLevel);
        expect(levelProg.level).toEqual(level);
      });

      test("nextLevel", () => {
        expect(levelProg.nextLevelXpPercentage).toBeLessThanOrEqual(100);
        expect(levelProg.nextLevelXpPercentage).toBeGreaterThanOrEqual(0);

        expect(levelProg.nextLevelXpRequired).toEqual(wantNextLevelXpRequired);
        expect(levelProg.nextLevelXpProgress).toEqual(wantNextLevelXpProgress);
        expect(levelProg.nextLevelXpPercentage).toEqual(
          (levelProg.nextLevelXpProgress / levelProg.nextLevelXpRequired) *
            100.0,
        );
      });
    },
  );
});
