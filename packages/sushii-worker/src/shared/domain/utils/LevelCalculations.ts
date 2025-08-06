export interface LevelProgress {
  level: number;
  nextLevelXpProgress: number;
  nextLevelXpRequired: number;
  nextLevelXpPercentage: number;
}

export function calculateLevel(xp: number | bigint): number {
  const xpNum = typeof xp === "bigint" ? Number(xp) : xp;
  return Math.floor((Math.sqrt(100 * (2 * xpNum + 25)) + 50) / 100);
}

export function calculateLevelProgress(xp: number | bigint): LevelProgress {
  const xpNum = typeof xp === "bigint" ? Number(xp) : xp;
  const currentLevel = calculateLevel(xpNum);

  // Calculate XP required for current level
  const currentLevelXp =
    currentLevel === 1 ? 0 : (currentLevel - 1) * currentLevel * 50;

  // Calculate XP required for next level
  const nextLevelXp = currentLevel * (currentLevel + 1) * 50;

  // Calculate progress within current level
  const nextLevelXpProgress = xpNum - currentLevelXp;
  const nextLevelXpRequired = nextLevelXp - currentLevelXp;
  const nextLevelXpPercentage =
    (nextLevelXpProgress / nextLevelXpRequired) * 100;

  return {
    level: currentLevel,
    nextLevelXpProgress,
    nextLevelXpRequired,
    nextLevelXpPercentage,
  };
}

export function calculateXpForLevel(level: number): number {
  if (level === 1) return 0;
  return (level - 1) * level * 50;
}