import type { Result } from "ts-results";
import type { CachedUserEntity, NewCachedUser } from "../entities";

export interface CachedUserRepository {
  upsert(userData: NewCachedUser): Promise<Result<CachedUserEntity, string>>;
  batchUpsert(usersData: NewCachedUser[]): Promise<Result<CachedUserEntity[], string>>;
}