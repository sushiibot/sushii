import type { InferInsertModel, InferSelectModel } from "drizzle-orm";

import type { cachedUsersInAppPublic } from "@/infrastructure/database/schema";

export type CachedUser = InferSelectModel<typeof cachedUsersInAppPublic>;
export type NewCachedUser = InferInsertModel<typeof cachedUsersInAppPublic>;

export class CachedUserEntity {
  constructor(private readonly data: CachedUser) {}

  get id(): bigint {
    return this.data.id;
  }

  get name(): string {
    return this.data.name;
  }

  get discriminator(): number {
    return this.data.discriminator;
  }

  get avatarUrl(): string {
    return this.data.avatarUrl;
  }

  get lastChecked(): Date {
    return this.data.lastChecked;
  }

  toData(): CachedUser {
    return this.data;
  }

  static fromData(data: CachedUser): CachedUserEntity {
    return new CachedUserEntity(data);
  }
}
