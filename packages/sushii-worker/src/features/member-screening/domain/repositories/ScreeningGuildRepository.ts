import type { ScreeningGuildSettings } from "../types";

export interface ScreeningGuildRepository {
  /** Called on every message: served from an in-memory snapshot refreshed at most every 60s. */
  findByGuildId(guildId: string): Promise<ScreeningGuildSettings | null>;
  list(): Promise<ScreeningGuildSettings[]>;
  /** Inserts or replaces, then refreshes the local snapshot. */
  upsert(settings: ScreeningGuildSettings): Promise<ScreeningGuildSettings>;
  /** Returns false when the guild wasn't allowlisted. */
  delete(guildId: string): Promise<boolean>;
}
