import dayjs from "@/shared/domain/dayjs";

import type { StreakMilestone } from "../constants";
import { REP_INCREMENT, STREAK_MILESTONES } from "../constants";

export interface StreakUpdate {
  streak: number;
  multiplier: number;
  // Next milestone to reach, null once at the cap
  nextMilestone: StreakMilestone | null;
  // Length of the streak that was lost, if a missed day reset it
  brokenStreak: number | null;
}

/**
 * Streaks count consecutive UTC days with at least one use. Using the command
 * again on the same UTC day keeps the streak, the next UTC day extends it, and
 * skipping a full UTC day resets it to 1.
 */
export function calculateStreak(
  lastUsed: Date | null,
  currentStreak: number,
  now: Date,
): StreakUpdate {
  let streak = 1;
  let brokenStreak: number | null = null;

  if (lastUsed) {
    const daysSince = dayjs
      .utc(now)
      .startOf("day")
      .diff(dayjs.utc(lastUsed).startOf("day"), "day");

    if (daysSince <= 0) {
      // Existing users have a last used time but no streak yet
      streak = Math.max(currentStreak, 1);
    } else if (daysSince === 1) {
      streak = currentStreak + 1;
    } else if (currentStreak > 1) {
      brokenStreak = currentStreak;
    }
  }

  return {
    streak,
    multiplier: getStreakMultiplier(streak),
    nextMilestone: getNextStreakMilestone(streak),
    brokenStreak,
  };
}

export function getStreakMultiplier(streak: number): number {
  let multiplier = 1;

  for (const milestone of STREAK_MILESTONES) {
    if (streak >= milestone.days) {
      multiplier = milestone.multiplier;
    }
  }

  return multiplier;
}

export function getNextStreakMilestone(streak: number): StreakMilestone | null {
  return STREAK_MILESTONES.find((m) => m.days > streak) ?? null;
}

/**
 * Rep is whole, so the multiplier's fractional part is the chance of doubling
 * the rep given. On average this matches the fishy multiplier.
 */
export function rollRepAmount(
  multiplier: number,
  random: number = Math.random(),
): number {
  return random < multiplier - 1 ? REP_INCREMENT * 2 : REP_INCREMENT;
}
