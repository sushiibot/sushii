export enum CatchableType {
  Anchovy = "anchovy",
  Salmon = "salmon",
  AtlanticSalmon = "atlantic salmon",
  Tuna = "tuna",
  Halibut = "halibut",
  SeaBass = "sea bass",
  YellowfinTuna = "yellow tuna",
  PufferFish = "puffer fishy",
  WildKingSalmon = "wild king salmon",
  SwordFish = "swordfish fish",
  BluefinTuna = "bluefin tuna",
  // Constant probability catchable types
  Seaweed = "seaweed",
  Algae = "algae",
  // Special fishy types with custom rarities
  Golden = "golden fishy <:goldenFishy:418504966337069057>",
  Rotten = "rotten 🦴",
  MrsPuff = "Mrs. Puff 🐡",
  RustySpoon = "rusty spoon 🥄",
  // Patreon Fishies
  Wawa = "wawa 🍉",
  Dan = "dan",
  Crazy = "crazy fishy 🤪",
  Jae = "jae fishy",
}

export interface FishyValueRange {
  min: number;
  max: number;
  skew: number;
}

export const FISHY_VALUE_RANGES: Record<CatchableType, FishyValueRange> = {
  [CatchableType.Anchovy]: { min: 5, max: 10, skew: 3 },
  [CatchableType.Salmon]: { min: 15, max: 30, skew: 3 },
  [CatchableType.Halibut]: { min: 10, max: 30, skew: 3 },
  [CatchableType.AtlanticSalmon]: { min: 20, max: 25, skew: 3 },
  [CatchableType.Tuna]: { min: 30, max: 80, skew: 3 },
  [CatchableType.SeaBass]: { min: 40, max: 50, skew: 3 },
  [CatchableType.YellowfinTuna]: { min: 40, max: 50, skew: 3 },
  [CatchableType.PufferFish]: { min: 20, max: 50, skew: 3 },
  [CatchableType.WildKingSalmon]: { min: 20, max: 50, skew: 3 },
  [CatchableType.SwordFish]: { min: 40, max: 60, skew: 3 },
  [CatchableType.BluefinTuna]: { min: 40, max: 70, skew: 3 },
  [CatchableType.Seaweed]: { min: 8, max: 15, skew: 1 },
  [CatchableType.Algae]: { min: 1, max: 5, skew: 1 },
  [CatchableType.Golden]: { min: 100, max: 400, skew: 3 },
  [CatchableType.Rotten]: { min: 1, max: 5, skew: 3 },
  [CatchableType.MrsPuff]: { min: 50, max: 80, skew: 3 },
  [CatchableType.RustySpoon]: { min: 1, max: 2, skew: 1 },
  // Patreon fishies
  [CatchableType.Wawa]: { min: 20, max: 80, skew: 2 },
  [CatchableType.Dan]: { min: 20, max: 80, skew: 2 },
  [CatchableType.Crazy]: { min: 20, max: 80, skew: 2 },
  [CatchableType.Jae]: { min: 20, max: 80, skew: 2 },
};

// Simplified fish type categories for randomization
export const SCALED_FISH_TYPES = [
  CatchableType.Anchovy,
  CatchableType.Salmon,
  CatchableType.AtlanticSalmon,
  CatchableType.Tuna,
  CatchableType.Halibut,
  CatchableType.SeaBass,
  CatchableType.YellowfinTuna,
  CatchableType.PufferFish,
  CatchableType.WildKingSalmon,
  CatchableType.SwordFish,
  CatchableType.BluefinTuna,
  CatchableType.Wawa,
  CatchableType.Dan,
  CatchableType.Crazy,
  CatchableType.Jae,
];

export const SCALED_FISH_WEIGHTS = [
  100, // Anchovy
  70, // Salmon
  60, // AtlanticSalmon
  50, // Tuna
  70, // Halibut
  30, // SeaBass
  40, // YellowfinTuna
  20, // PufferFish
  70, // WildKingSalmon
  20, // SwordFish
  40, // BluefinTuna
  40, // Wawa
  30, // Dan
  30, // Crazy
  30, // Jae
];

export const NORMAL_FISH_TYPES = [
  CatchableType.Seaweed,
  CatchableType.Algae,
];

export const RARE_FISH_TYPES = [
  CatchableType.Rotten,
  CatchableType.MrsPuff,
  CatchableType.RustySpoon,
];

// Fish catch probabilities (must total 100%)
export const FISH_PROBABILITIES = {
  GOLDEN: 1,      // 0-1%
  RARE: 3,        // 1-4% (3% for Rotten, MrsPuff, RustySpoon)
  NORMAL: 4,      // 4-8% (Seaweed, Algae)
  SCALED: 92,     // 8-100% (Regular fish with weights)
} as const;