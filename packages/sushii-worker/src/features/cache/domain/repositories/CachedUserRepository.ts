import type { CachedUserEntity, NewCachedUser } from "../entities";

export interface CachedUserRepository {
  upsert(userData: NewCachedUser): Promise<CachedUserEntity>;
  batchUpsert(usersData: NewCachedUser[]): Promise<CachedUserEntity[]>;
}
