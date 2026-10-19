export interface StreakMilestone {
  days: number;
  multiplier: number;
  label: string;
}

// Streak multipliers, in ascending order of days. The last is the cap.
export const STREAK_MILESTONES: readonly StreakMilestone[] = [
  { days: 7, multiplier: 1.1, label: "1 week" },
  { days: 30, multiplier: 1.25, label: "1 month" },
  { days: 90, multiplier: 1.5, label: "3 months" },
  { days: 180, multiplier: 1.75, label: "6 months" },
  { days: 365, multiplier: 2, label: "1 year" },
];
