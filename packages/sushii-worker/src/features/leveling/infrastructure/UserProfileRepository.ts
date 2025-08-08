import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";
import { usersInAppPublic } from "@/infrastructure/database/schema";

import { UserProfile } from "../domain/entities/UserProfile";
import type { UserProfileRepository as UserProfileRepositoryI } from "../domain/repositories/UserProfileRepository";

export type DrizzleDB = NodePgDatabase<typeof schema>;

export class UserProfileRepository implements UserProfileRepositoryI {
  constructor(private readonly db: DrizzleDB) {}

  private async getUserOrDefault(userId: string) {
    try {
      const result = await this.db
        .select()
        .from(usersInAppPublic)
        .where(eq(usersInAppPublic.id, BigInt(userId)))
        .limit(1);

      if (result[0]) {
        return result[0];
      }

      // Return default user if not found
      return {
        id: BigInt(userId),
        rep: 0n,
        fishies: 0n,
        isPatron: false,
        lastFishies: null,
        lastRep: null,
        lastfmUsername: null,
        patronEmoji: null,
        profileData: {},
      };
    } catch (error) {
      console.error(error);

      throw new Error(
        `Failed to query user profile for userId ${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getUserProfile(userId: string): Promise<UserProfile> {
    const userData = await this.getUserOrDefault(userId);

    return UserProfile.create(userId, {
      rep: Number(userData.rep),
      fishies: Number(userData.fishies),
      isPatron: userData.isPatron,
      profileData: userData.profileData as { patronEmojiURL?: string } | null,
    });
  }
}
