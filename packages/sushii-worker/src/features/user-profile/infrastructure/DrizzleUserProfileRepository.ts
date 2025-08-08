import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

import * as schema from "@/infrastructure/database/schema";
import { UserProfile } from "../domain/entities/UserProfile";
import { UserProfileRepository } from "../domain/repositories/UserProfileRepository";

export class DrizzleUserProfileRepository implements UserProfileRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async getById(id: string): Promise<UserProfile | null> {
    const result = await this.db
      .select()
      .from(schema.usersInAppPublic)
      .where(eq(schema.usersInAppPublic.id, BigInt(id)))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    const row = result[0];
    return UserProfile.create({
      id: row.id.toString(),
      rep: row.rep,
      fishies: row.fishies,
      isPatron: row.isPatron,
      lastFishies: row.lastFishies,
      lastRep: row.lastRep,
      lastfmUsername: row.lastfmUsername,
      patronEmoji: row.patronEmoji,
      profileData: (row.profileData as Record<string, unknown>) || {},
    });
  }

  async getByIdOrDefault(id: string): Promise<UserProfile> {
    const profile = await this.getById(id);
    if (profile) {
      return profile;
    }

    return UserProfile.createDefault(id);
  }

  async save(profile: UserProfile): Promise<UserProfile> {
    return this.upsert(profile);
  }

  async upsert(profile: UserProfile): Promise<UserProfile> {
    const data = profile.toData();
    
    const result = await this.db
      .insert(schema.usersInAppPublic)
      .values({
        id: BigInt(data.id),
        rep: data.rep,
        fishies: data.fishies,
        isPatron: data.isPatron,
        lastFishies: data.lastFishies,
        lastRep: data.lastRep,
        lastfmUsername: data.lastfmUsername,
        patronEmoji: data.patronEmoji,
        profileData: data.profileData,
      })
      .onConflictDoUpdate({
        target: schema.usersInAppPublic.id,
        set: {
          rep: data.rep,
          fishies: data.fishies,
          isPatron: data.isPatron,
          lastFishies: data.lastFishies,
          lastRep: data.lastRep,
          lastfmUsername: data.lastfmUsername,
          patronEmoji: data.patronEmoji,
          profileData: data.profileData,
        },
      })
      .returning();

    const row = result[0];
    return UserProfile.create({
      id: row.id.toString(),
      rep: row.rep,
      fishies: row.fishies,
      isPatron: row.isPatron,
      lastFishies: row.lastFishies,
      lastRep: row.lastRep,
      lastfmUsername: row.lastfmUsername,
      patronEmoji: row.patronEmoji,
      profileData: (row.profileData as Record<string, unknown>) || {},
    });
  }
}