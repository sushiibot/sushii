import type { UserProfile } from "../entities/UserProfile";

export interface UserProfileRepository {
  getUserProfile(userId: string): Promise<UserProfile>;
  setGlobalLeaderboardAnonymous(userId: string, anonymous: boolean): Promise<void>;
}
