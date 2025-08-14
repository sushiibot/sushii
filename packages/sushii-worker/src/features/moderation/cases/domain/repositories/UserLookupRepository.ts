import type { Result } from "ts-results";

import type { UserLookupBan } from "../entities/UserLookupBan";

/**
 * Repository interface for user lookup operations.
 * Provides cross-server ban information.
 */
export interface UserLookupRepository {
  /**
   * Gets all bans for a user across all guilds with detailed information.
   * @param userId The user ID to lookup
   * @returns Array of ban information including guild details and reasons
   */
  getUserCrossServerBans(
    userId: string,
  ): Promise<Result<UserLookupBan[], string>>;
}
