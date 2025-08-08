import type { Logger } from "pino";

import type { Tag } from "../domain/entities/Tag";
import type { TagRepository } from "../domain/repositories/TagRepository";
import type { TagFiltersData } from "../domain/value-objects/TagFilters";
import { TagFilters } from "../domain/value-objects/TagFilters";

export class TagSearchService {
  constructor(
    private readonly tagRepository: TagRepository,
    private readonly logger: Logger,
  ) {}

  async getAllTags(guildId: string): Promise<Tag[]> {
    this.logger.debug({ guildId }, "Getting all tags for guild");
    return this.tagRepository.findAllByGuild(guildId);
  }

  async getPaginatedTags(
    guildId: string,
    page: number,
    pageSize: number,
  ): Promise<string[]> {
    this.logger.debug(
      { guildId, page, pageSize },
      "Getting paginated tags for guild",
    );
    const offset = page * pageSize;
    return this.tagRepository.findPaginatedByGuild(guildId, offset, pageSize);
  }

  async getTagCount(guildId: string): Promise<number> {
    this.logger.debug({ guildId }, "Getting tag count for guild");
    return this.tagRepository.countByGuild(guildId);
  }

  async searchTags(params: TagFiltersData): Promise<Tag[]> {
    this.logger.debug({ params }, "Searching tags with filters");

    // Allow EMPTY strings, but not undefined - empty strings just means
    // no filter and returning all tags
    if (
      params.startsWith === undefined &&
      !params.contains &&
      !params.ownerId
    ) {
      throw new Error("At least one search parameter must be provided");
    }

    if (params.startsWith && params.contains) {
      throw new Error("Cannot use both startsWith and contains filters");
    }

    const filters = TagFilters.create({
      guildId: params.guildId,
      startsWith: params.startsWith,
      contains: params.contains,
      ownerId: params.ownerId,
    });

    return this.tagRepository.findByFilters(filters, 25);
  }

  async getRandomTag(params: TagFiltersData): Promise<Tag | null> {
    this.logger.debug({ params }, "Getting random tag with filters");

    if (params.startsWith && params.contains) {
      throw new Error("Cannot use both startsWith and contains filters");
    }

    const filters = TagFilters.create({
      guildId: params.guildId,
      startsWith: params.startsWith,
      contains: params.contains,
      ownerId: params.ownerId,
    });

    return this.tagRepository.findRandomByFilters(filters);
  }

  async getTagsForAutocomplete(guildId: string, query: string): Promise<Tag[]> {
    this.logger.debug({ guildId, query }, "Getting tags for autocomplete");
    return this.tagRepository.findByAutocomplete(guildId, query);
  }
}
