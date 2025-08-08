import { InferSelectModel, InferInsertModel } from "drizzle-orm";
import { cachedGuildsInAppPublic } from "@/infrastructure/database/schema";

export type CachedGuild = InferSelectModel<typeof cachedGuildsInAppPublic>;
export type NewCachedGuild = InferInsertModel<typeof cachedGuildsInAppPublic>;

export class CachedGuildEntity {
  constructor(private readonly data: CachedGuild) {}

  get id(): bigint {
    return this.data.id;
  }

  get name(): string {
    return this.data.name;
  }

  get icon(): string | null {
    return this.data.icon;
  }

  get banner(): string | null {
    return this.data.banner;
  }

  get splash(): string | null {
    return this.data.splash;
  }

  get features(): string[] {
    return this.data.features;
  }

  get createdAt(): string {
    return this.data.createdAt;
  }

  get updatedAt(): string {
    return this.data.updatedAt;
  }

  toData(): CachedGuild {
    return this.data;
  }

  static fromData(data: CachedGuild): CachedGuildEntity {
    return new CachedGuildEntity(data);
  }
}