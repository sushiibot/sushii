export interface ServerNameHistoryRepository {
  /** Upserts each name, marking it as used now. */
  record(guildId: string, names: string[]): Promise<void>;
  /** Most recently used first, case-insensitive substring match. */
  search(
    guildId: string,
    query: string,
    excludeName: string,
    limit: number,
  ): Promise<string[]>;
}
