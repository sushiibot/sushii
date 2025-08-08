import type { Tag } from "../entities/Tag";
import type { TagFilters } from "../value-objects/TagFilters";
import type { TagName } from "../value-objects/TagName";

export interface TagRepository {
  save(tag: Tag): Promise<void>;
  findByNameAndGuild(name: TagName, guildId: string): Promise<Tag | null>;
  findByFilters(filters: TagFilters, limit: number): Promise<Tag[]>;
  findRandomByFilters(filters: TagFilters): Promise<Tag | null>;
  findAllByGuild(guildId: string): Promise<Tag[]>;
  findPaginatedByGuild(
    guildId: string,
    offset: number,
    limit: number,
  ): Promise<string[]>;
  countByGuild(guildId: string): Promise<number>;
  findByAutocomplete(guildId: string, query: string): Promise<Tag[]>;
  delete(name: TagName, guildId: string): Promise<Tag | null>;
  deleteAllByOwner(guildId: string, ownerId: string): Promise<number>;
}
