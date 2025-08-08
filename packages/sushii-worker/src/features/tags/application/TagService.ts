import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type { TagData } from "../domain/entities/Tag";
import { Tag } from "../domain/entities/Tag";
import type { TagRepository } from "../domain/repositories/TagRepository";
import { TagName } from "../domain/value-objects/TagName";

export interface CreateTagParams {
  name: string;
  content: string | null;
  attachment: string | null;
  guildId: string;
  ownerId: string;
}

export interface UpdateTagParams {
  name: string;
  guildId: string;
  userId: string;
  hasManageGuildPermission: boolean;
  newContent?: string | null;
  newAttachment?: string | null;
}

export interface RenameTagParams {
  currentName: string;
  newName: string;
  guildId: string;
  userId: string;
  hasManageGuildPermission: boolean;
}

export interface DeleteTagParams {
  name: string;
  guildId: string;
  userId: string;
  hasManageGuildPermission: boolean;
}

export class TagService {
  constructor(
    private readonly tagRepository: TagRepository,
    private readonly logger: Logger,
  ) {}

  async createTag(params: CreateTagParams): Promise<Result<Tag, string>> {
    this.logger.debug({ params }, "Creating new tag");

    const nameResult = TagName.create(params.name);
    if (nameResult.err) {
      return Err(nameResult.val);
    }

    const existingTag = await this.tagRepository.findByNameAndGuild(
      nameResult.val,
      params.guildId,
    );

    if (existingTag) {
      return Err(`Tag '${params.name}' already exists`);
    }

    const tagData: TagData = {
      name: params.name,
      content: params.content,
      attachment: params.attachment,
      guildId: params.guildId,
      ownerId: params.ownerId,
      useCount: BigInt(0),
      created: new Date(),
    };

    const tagResult = Tag.create(tagData);
    if (tagResult.err) {
      return Err(tagResult.val);
    }

    const tag = tagResult.val;
    await this.tagRepository.save(tag);

    this.logger.info(
      { tagName: params.name, guildId: params.guildId },
      "Tag created successfully",
    );

    return Ok(tag);
  }

  async getTag(name: string, guildId: string): Promise<Tag | null> {
    const nameResult = TagName.create(name);
    if (nameResult.err) {
      return null;
    }

    return this.tagRepository.findByNameAndGuild(nameResult.val, guildId);
  }

  async useTag(name: string, guildId: string): Promise<Result<Tag, string>> {
    const tag = await this.getTag(name, guildId);
    if (!tag) {
      return Err(`Tag '${name}' not found`);
    }

    tag.incrementUseCount();
    await this.tagRepository.save(tag);

    this.logger.debug(
      { tagName: name, guildId, useCount: tag.getUseCount() },
      "Tag use count incremented",
    );

    return Ok(tag);
  }

  async updateTag(params: UpdateTagParams): Promise<Result<Tag, string>> {
    const tag = await this.getTag(params.name, params.guildId);
    if (!tag) {
      return Err(`Tag '${params.name}' not found`);
    }

    if (!tag.canBeModifiedBy(params.userId, params.hasManageGuildPermission)) {
      return Err("You don't have permission to edit this tag");
    }

    if (!params.newContent && !params.newAttachment) {
      return Err("Must provide either new content or new attachment");
    }

    const content =
      params.newContent !== undefined ? params.newContent : tag.getContent();

    const attachment =
      params.newAttachment !== undefined
        ? params.newAttachment
        : tag.getAttachment();

    const updateResult = tag.updateContent(content, attachment);
    if (updateResult.err) {
      return Err(updateResult.val);
    }

    await this.tagRepository.save(tag);

    this.logger.info(
      { tagName: params.name, guildId: params.guildId },
      "Tag updated successfully",
    );

    return Ok(tag);
  }

  async renameTag(params: RenameTagParams): Promise<Result<Tag, string>> {
    const tag = await this.getTag(params.currentName, params.guildId);
    if (!tag) {
      return Err(`Tag '${params.currentName}' not found`);
    }

    if (!tag.canBeModifiedBy(params.userId, params.hasManageGuildPermission)) {
      return Err("You don't have permission to rename this tag");
    }

    const newNameResult = TagName.create(params.newName);
    if (newNameResult.err) {
      return Err(newNameResult.val);
    }

    const existingTag = await this.tagRepository.findByNameAndGuild(
      newNameResult.val,
      params.guildId,
    );

    if (existingTag) {
      return Err(`Tag '${params.newName}' already exists`);
    }

    const deletedTag = await this.tagRepository.delete(
      tag.getName(),
      params.guildId,
    );
    if (!deletedTag) {
      return Err(`Failed to delete old tag '${params.currentName}'`);
    }

    const newTagData: TagData = {
      ...tag.toData(),
      name: params.newName,
    };

    const newTagResult = Tag.create(newTagData);
    if (newTagResult.err) {
      return Err(newTagResult.val);
    }

    const newTag = newTagResult.val;
    await this.tagRepository.save(newTag);

    this.logger.info(
      {
        oldName: params.currentName,
        newName: params.newName,
        guildId: params.guildId,
      },
      "Tag renamed successfully",
    );

    return Ok(newTag);
  }

  async deleteTag(params: DeleteTagParams): Promise<Result<Tag, string>> {
    const tag = await this.getTag(params.name, params.guildId);
    if (!tag) {
      return Err(`Tag '${params.name}' not found`);
    }

    if (!tag.canBeModifiedBy(params.userId, params.hasManageGuildPermission)) {
      return Err("You don't have permission to delete this tag");
    }

    const deletedTag = await this.tagRepository.delete(
      tag.getName(),
      params.guildId,
    );

    if (!deletedTag) {
      return Err(`Failed to delete tag '${params.name}'`);
    }

    this.logger.info(
      { tagName: params.name, guildId: params.guildId },
      "Tag deleted successfully",
    );

    return Ok(deletedTag);
  }
}
