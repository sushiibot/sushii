import {
  ACTIVE_DAYS_WINDOW,
  MAX_ACTIVE_DAYS_BONUS,
  REP_INCREMENT,
} from "../constants";

const MS_PER_DAY = 86_400_000;
const WINDOW_MASK = 2 ** ACTIVE_DAYS_WINDOW - 1;

export interface ActiveDaysState {
  mask: number;
  // UTC day number of bit 0, null before the first use
  anchorDay: number | null;
}

export interface ActiveDaysUpdate extends ActiveDaysState {
  anchorDay: number;
  // Days used out of the last ACTIVE_DAYS_WINDOW, including today
  activeDays: number;
  multiplier: number;
  // False when the command was already used earlier this UTC day
  isNewDay: boolean;
}

export function utcDayNumber(date: Date): number {
  return Math.floor(date.getTime() / MS_PER_DAY);
}

export function recordActiveDay(
  state: ActiveDaysState,
  now: Date,
): ActiveDaysUpdate {
  const today = utcDayNumber(now);
  let mask = 1;
  let anchorDay = today;
  let isNewDay = true;

  if (state.anchorDay !== null) {
    const gap = today - state.anchorDay;

    if (gap <= 0) {
      // Clock skew can't move the window backwards
      mask = state.mask | 1;
      anchorDay = state.anchorDay;
      isNewDay = false;
    } else if (gap < ACTIVE_DAYS_WINDOW) {
      // Larger gaps keep the fresh mask, which also avoids JS shifts wrapping at 32
      mask = ((state.mask << gap) | 1) & WINDOW_MASK;
    }
  }

  const activeDays = countActiveDays(mask);

  return {
    mask,
    anchorDay,
    activeDays,
    multiplier: getActiveDaysMultiplier(activeDays),
    isNewDay,
  };
}

export function countActiveDays(mask: number): number {
  let count = 0;
  for (let bits = mask & WINDOW_MASK; bits; bits &= bits - 1) {
    count++;
  }

  return count;
}

export function getActiveDaysMultiplier(activeDays: number): number {
  return (
    1 +
    (MAX_ACTIVE_DAYS_BONUS * Math.min(activeDays, ACTIVE_DAYS_WINDOW)) /
      ACTIVE_DAYS_WINDOW
  );
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
