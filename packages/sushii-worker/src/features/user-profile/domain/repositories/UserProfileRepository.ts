import type { UserProfile } from "../entities/UserProfile";

export interface UserProfileRepository {
  getById(id: string): Promise<UserProfile | null>;
  getByIdOrDefault(id: string): Promise<UserProfile>;
  save(profile: UserProfile): Promise<UserProfile>;
  upsert(profile: UserProfile): Promise<UserProfile>;
}
