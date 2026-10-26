import type { ScreeningGuildSettings } from "../types";

export type ScreeningGuildPatch = Partial<
  Omit<ScreeningGuildSettings, "guildId">
>;

export interface ScreeningGuildRepository {
  /** Called on every message: served from an in-memory snapshot refreshed at most every 60s. */
  findByGuildId(guildId: string): Promise<ScreeningGuildSettings | null>;
  list(): Promise<ScreeningGuildSettings[]>;
  /** Inserts or replaces, then refreshes the local snapshot. */
  upsert(settings: ScreeningGuildSettings): Promise<ScreeningGuildSettings>;
  /** Changes only the given fields, creating the row from defaults when missing; refreshes the local snapshot. */
  patch(
    guildId: string,
    changes: ScreeningGuildPatch,
  ): Promise<ScreeningGuildSettings>;
  /** Returns false when the guild had no settings row. */
  delete(guildId: string): Promise<boolean>;
}
