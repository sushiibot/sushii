import type { Tag } from "../entities/Tag";
import type { TagFilters } from "../value-objects/TagFilters";
import type { TagName } from "../value-objects/TagName";

export interface TagRepository {
  save(tag: Tag): Promise<void>;
  create(tag: Tag): Promise<Tag | null>;
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
  /**
   * Finds up to 25 tags whose name contains the query. When ownerId is
   * provided, only tags owned by that user are returned.
   */
  findByAutocomplete(
    guildId: string,
    query: string,
    ownerId?: string,
  ): Promise<Tag[]>;
  incrementUseCount(name: TagName, guildId: string): Promise<Tag | null>;
  rename(currentName: TagName, newName: TagName, guildId: string): Promise<Tag | null>;
  delete(name: TagName, guildId: string): Promise<Tag | null>;
  deleteAllByOwner(guildId: string, ownerId: string): Promise<number>;
}
