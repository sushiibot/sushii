import type {
  NewUserNameHistoryEntry,
  UserNameHistoryEntry,
} from "../entities/UserNameHistoryEntry";

export interface UserNameHistoryRepository {
  /**
   * Insert a history entry only if the most recent entry for this
   * (userId, nameType, guildId) combination has a different value.
   * Returns true if a row was inserted, false if deduped.
   */
  insertIfChanged(entry: NewUserNameHistoryEntry): Promise<boolean>;

  findByUserId(
    userId: bigint,
    limit?: number,
  ): Promise<UserNameHistoryEntry[]>;
}
