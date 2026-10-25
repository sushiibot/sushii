import type { User } from "discord.js";

import dayjs from "@/shared/domain/dayjs";

import type { FishyResult } from "../domain";
import {
  CatchableType,
  FISHY_VALUE_RANGES,
  FISH_PROBABILITIES,
  NORMAL_FISH_TYPES,
  SCALED_FISH_TYPES,
  SCALED_FISH_WEIGHTS,
} from "../domain";
import type { FishyCollectionRepository } from "../domain/repositories/FishyCollectionRepository";

export class FishyService {
  constructor(
    private readonly collectionRepository: FishyCollectionRepository,
  ) {}

  async fishyForUser(
    invoker: User,
    target: User,
    interactionId: string,
  ): Promise<FishyResult | dayjs.Dayjs> {
    const result = await this.collectionRepository.catchFishy(
      invoker.id,
      target.id,
      interactionId,
      () => {
        const caughtType = this.getRandomCatchable();
        const range = FISHY_VALUE_RANGES[caughtType];
        return {
          caughtType,
          baseAmount: Math.floor(
            this.randDistNumber(range.min, range.max, range.skew),
          ),
        };
      },
    );
    return result instanceof Date ? dayjs.utc(result) : result;
  }

  private getRandomCatchable(): CatchableType {
    const rand = Math.random() * 100;

    // Golden fishy
    if (rand < FISH_PROBABILITIES.GOLDEN) {
      return CatchableType.Golden;
    }

    // Other rare types
    if (rand < FISH_PROBABILITIES.GOLDEN + FISH_PROBABILITIES.RARE) {
      const rareTypes = [
        CatchableType.Rotten,
        CatchableType.MrsPuff,
        CatchableType.RustySpoon,
      ];
      return this.getRandomFromArray(rareTypes);
    }

    // Normal types (seaweed/algae)
    if (
      rand <
      FISH_PROBABILITIES.GOLDEN +
        FISH_PROBABILITIES.RARE +
        FISH_PROBABILITIES.NORMAL
    ) {
      return this.getRandomFromArray(NORMAL_FISH_TYPES);
    }

    // Scaled types with weights
    return this.weightedRandom(SCALED_FISH_TYPES, SCALED_FISH_WEIGHTS);
  }

  private getRandomFromArray<T>(array: T[]): T {
    return array[Math.floor(Math.random() * array.length)];
  }

  private weightedRandom<T>(items: T[], weights: number[]): T {
    let i;
    const weightsCopy = weights.slice();

    for (i = 0; i < weightsCopy.length; i += 1) {
      weightsCopy[i] += weightsCopy[i - 1] || 0;
    }

    const random = Math.random() * weightsCopy[weightsCopy.length - 1];

    for (i = 0; i < weightsCopy.length; i += 1) {
      if (weightsCopy[i] > random) {
        break;
      }
    }

    return items[i];
  }

  private randDistNumber(
    min: number,
    max: number,
    skew: number,
    depth = 0,
  ): number {
    // Prevent infinite recursion - fallback to simple random after 10 attempts
    if (depth > 10) {
      return Math.random() * (max - min) + min;
    }

    let u = 0;
    let v = 0;

    // Convert [0,1) to (0,1)
    while (u === 0) {
      u = Math.random();
    }
    while (v === 0) {
      v = Math.random();
    }

    let num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);

    num = num / 10.0 + 0.5; // Translate to 0 -> 1
    if (num > 1 || num < 0) {
      num = this.randDistNumber(min, max, skew, depth + 1);
    } else {
      num **= skew; // Skew
      num *= max - min; // Stretch to fill range
      num += min; // offset to min
    }

    return num;
  }
}
