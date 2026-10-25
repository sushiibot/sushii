import { randomInt } from "node:crypto";
import { z } from "zod";

import source from "./catalog.json";

export const raritySchema = z.enum([
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
]);
export const conditionSchema = z.enum([
  "still",
  "light_rain",
  "heavy_rain",
  "mist",
  "moonlit",
]);
export type Rarity = z.infer<typeof raritySchema>;
export type FishingCondition = z.infer<typeof conditionSchema>;
const itemSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  name: z.string(),
  set: z.string(),
  rarity: raritySchema,
  baseWeight: z.number().int().positive(),
  preferredCondition: conditionSchema,
  conditionMultiplier: z.number().positive(),
  habitat: z.string(),
});
export type Collectible = z.infer<typeof itemSchema>;
export const COLLECTIBLES = z.array(itemSchema).parse(source.items);
export const COLLECTION_SETS: Record<string, string> = source.sets;
export const RARITY_WEIGHTS = Object.fromEntries(
  raritySchema.options.map((tier) => [
    tier,
    Math.round(source.rarityProbabilities[tier] * 10000),
  ]),
) as Record<Rarity, number>;
if (Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0) !== 10000)
  throw new Error("Rarity probabilities must total one");
export const CONDITION_LABELS: Record<FishingCondition, string> = {
  still: "Still waters",
  light_rain: "Light rain",
  heavy_rain: "Heavy rain",
  mist: "Rolling mist",
  moonlit: "Moonlit waters",
};
export const RARITY_COLORS: Record<Rarity, number> = {
  common: 0x9ca3af,
  uncommon: 0x78be93,
  rare: 0x6bafff,
  epic: 0xbe94ee,
  legendary: 0xf0c76b,
};
if (
  new Set(COLLECTIBLES.map((i) => i.id)).size !== COLLECTIBLES.length ||
  COLLECTIBLES.some((i) => !COLLECTION_SETS[i.set])
)
  throw new Error("Invalid collection catalog");
for (const tier of raritySchema.options)
  if (!COLLECTIBLES.some((i) => i.rarity === tier))
    throw new Error(`Empty rarity tier: ${tier}`);

export function getCollectible(id: string): Collectible {
  const item = COLLECTIBLES.find((i) => i.id === id);
  if (!item) throw new Error(`Unknown collectible: ${id}`);
  return item;
}

// Version 1 matches the schedule used by the accepted balance simulation.
export function fishingCondition(now: Date): FishingCondition {
  const slot = Math.floor(now.getTime() / (4 * 60 * 60 * 1000));
  const block = Math.floor(slot / 5);
  let seed = block ^ 0x53555348;
  const random = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const order = [...conditionSchema.options];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order[((slot % 5) + 5) % 5];
}

export function weightedPick<T>(
  values: readonly T[],
  weights: number[],
  draw: (max: number) => number = randomInt,
): T {
  const total = weights.reduce((a, b) => a + b, 0);
  if (
    !values.length ||
    values.length !== weights.length ||
    weights.some((w) => !Number.isSafeInteger(w) || w <= 0)
  )
    throw new Error("Invalid catch weights");
  let roll = draw(total);
  if (!Number.isInteger(roll) || roll < 0 || roll >= total)
    throw new Error("Invalid random draw");
  for (let i = 0; i < values.length; i++) {
    roll -= weights[i];
    if (roll < 0) return values[i];
  }
  throw new Error("Catch selection failed");
}

export function selectCollectible(
  condition: FishingCondition,
  draw: (max: number) => number = randomInt,
): Collectible {
  const tier = weightedPick(
    raritySchema.options,
    raritySchema.options.map((r) => RARITY_WEIGHTS[r]),
    draw,
  );
  const pool = COLLECTIBLES.filter((item) => item.rarity === tier);
  return weightedPick(
    pool,
    pool.map((item) =>
      Math.round(
        item.baseWeight *
          (item.preferredCondition === condition
            ? item.conditionMultiplier
            : 1),
      ),
    ),
    draw,
  );
}
