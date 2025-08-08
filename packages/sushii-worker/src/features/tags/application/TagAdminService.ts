import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type { Tag } from "../domain/entities/Tag";
import type { TagRepository } from "../domain/repositories/TagRepository";
import { TagName } from "../domain/value-objects/TagName";

export interface AdminDeleteTagParams {
  name: string;
  guildId: string;
}

export interface AdminDeleteUserTagsParams {
  guildId: string;
  ownerId: string;
}

export class TagAdminService {
  constructor(
    private readonly tagRepository: TagRepository,
    private readonly logger: Logger,
  ) {}

  async adminDeleteTag(
    params: AdminDeleteTagParams,
  ): Promise<Result<Tag, string>> {
    this.logger.debug({ params }, "Admin deleting tag");

    const nameResult = TagName.create(params.name);
    if (nameResult.err) {
      return Err(nameResult.val);
    }

    const deletedTag = await this.tagRepository.delete(
      nameResult.val,
      params.guildId,
    );

    if (!deletedTag) {
      return Err(`Tag '${params.name}' not found`);
    }

    this.logger.info(
      { tagName: params.name, guildId: params.guildId },
      "Tag deleted by admin",
    );

    return Ok(deletedTag);
  }

  async adminDeleteUserTags(
    params: AdminDeleteUserTagsParams,
  ): Promise<number> {
    this.logger.debug({ params }, "Admin deleting all user tags");

    const deleteCount = await this.tagRepository.deleteAllByOwner(
      params.guildId,
      params.ownerId,
    );

    this.logger.info(
      {
        guildId: params.guildId,
        ownerId: params.ownerId,
        deleteCount,
      },
      "User tags deleted by admin",
    );

    return deleteCount;
  }
}
