/**
 * Represents a ban for a user in a specific guild with additional metadata
 * for cross-server ban lookup functionality.
 */
export interface UserLookupBan {
  guildId: string;
  guildName: string | null;
  guildFeatures: string[];
  guildMembers: number;
  reason: string | null;
  actionTime: Date | null;
  lookupDetailsOptIn: boolean;
}
