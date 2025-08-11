import type { StatName } from "../StatName";

export interface BotStat {
  name: StatName;
  category: string;
  count: bigint;
}

export interface StatsRepository {
  setStat(name: StatName, category: string, count: number): Promise<void>;
  incrementStat(name: StatName, category: string, count: number): Promise<void>;
  getAllStats(): Promise<BotStat[]>;
}
