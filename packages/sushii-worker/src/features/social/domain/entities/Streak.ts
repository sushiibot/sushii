import dayjs from "@/shared/domain/dayjs";

import {
  REP_INCREMENT,
  STREAK_BONUS_START_DAYS,
  STREAK_MULTIPLIER_CAP,
  STREAK_MULTIPLIER_STEP,
} from "../constants";

export interface StreakUpdate {
  streak: number;
  multiplier: number;
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
    brokenStreak,
  };
}

/**
 * No bonus before STREAK_BONUS_START_DAYS, then +STEP each time the streak
 * doubles: 7d 1.1x, 14d 1.2x, 28d 1.3x, 56d 1.4x, 112d+ 1.5x.
 */
export function getStreakMultiplier(streak: number): number {
  if (streak < STREAK_BONUS_START_DAYS) {
    return 1;
  }

  const doublings = Math.log2(streak / STREAK_BONUS_START_DAYS);
  const multiplier = 1 + STREAK_MULTIPLIER_STEP * (1 + doublings);

  return Math.min(multiplier, STREAK_MULTIPLIER_CAP);
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
