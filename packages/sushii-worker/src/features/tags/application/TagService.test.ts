import { beforeEach, describe, expect, it } from "bun:test";
import type { Logger } from "pino";
import pino from "pino";

import type { TagData } from "../domain/entities/Tag";
import { Tag } from "../domain/entities/Tag";
import type { TagRepository } from "../domain/repositories/TagRepository";
import type { TagFilters } from "../domain/value-objects/TagFilters";
import type { TagName } from "../domain/value-objects/TagName";
import type {
  CreateTagParams,
  DeleteTagParams,
  RenameTagParams,
  UpdateTagParams,
} from "./TagService";
import { TagService } from "./TagService";

class MockTagRepository implements TagRepository {
  private tags = new Map<string, Tag>();

  async save(tag: Tag): Promise<void> {
    const key = this.createKey(tag.getName().getValue(), tag.getGuildId());
    this.tags.set(key, tag);
  }

  async findByNameAndGuild(
    name: TagName,
    guildId: string,
  ): Promise<Tag | null> {
    const key = this.createKey(name.getValue(), guildId);
    return this.tags.get(key) || null;
  }

  async findByFilters(_filters: TagFilters, _limit: number): Promise<Tag[]> {
    return Array.from(this.tags.values());
  }

  async findRandomByFilters(_filters: TagFilters): Promise<Tag | null> {
    const allTags = Array.from(this.tags.values());
    return allTags.length > 0 ? allTags[0] : null;
  }

  async findAllByGuild(guildId: string): Promise<Tag[]> {
    return Array.from(this.tags.values()).filter(
      (tag) => tag.getGuildId() === guildId,
    );
  }

  async findByAutocomplete(guildId: string, query: string): Promise<Tag[]> {
    return Array.from(this.tags.values()).filter(
      (tag) =>
        tag.getGuildId() === guildId &&
        tag.getName().getValue().includes(query),
    );
  }

  async delete(name: TagName, guildId: string): Promise<Tag | null> {
    const key = this.createKey(name.getValue(), guildId);
    const tag = this.tags.get(key);
    if (tag) {
      this.tags.delete(key);
      return tag;
    }
    return null;
  }

  async deleteAllByOwner(guildId: string, ownerId: string): Promise<number> {
    const toDelete = Array.from(this.tags.entries()).filter(
      ([_key, tag]) =>
        tag.getGuildId() === guildId && tag.getOwnerId() === ownerId,
    );
    toDelete.forEach(([key]) => this.tags.delete(key));
    return toDelete.length;
  }

  async findPaginatedByGuild(
    guildId: string,
    offset: number,
    limit: number,
  ): Promise<string[]> {
    const guildTags = Array.from(this.tags.values())
      .filter((tag) => tag.getGuildId() === guildId)
      .map((tag) => tag.getName().getValue())
      .sort();
    return guildTags.slice(offset, offset + limit);
  }

  async countByGuild(guildId: string): Promise<number> {
    return Array.from(this.tags.values()).filter(
      (tag) => tag.getGuildId() === guildId,
    ).length;
  }

  private createKey(name: string, guildId: string): string {
    return `${guildId}:${name.toLowerCase()}`;
  }

  // Test helper methods
  clear(): void {
    this.tags.clear();
  }

  size(): number {
    return this.tags.size;
  }

  addTag(tagData: TagData): Tag {
    const tagResult = Tag.create(tagData);
    if (tagResult.err) {
      throw new Error(tagResult.val);
    }
    const tag = tagResult.val;
    const key = this.createKey(tag.getName().getValue(), tag.getGuildId());
    this.tags.set(key, tag);
    return tag;
  }
}

describe("TagService", () => {
  let tagService: TagService;
  let mockRepository: MockTagRepository;
  let logger: Logger;

  const testGuildId = "123456789";
  const testUserId = "987654321";
  const testName = "test-tag";
  const testContent = "This is a test tag";

  beforeEach(() => {
    mockRepository = new MockTagRepository();
    logger = pino({ level: "silent" });
    tagService = new TagService(mockRepository, logger);
  });

  describe("createTag", () => {
    it("should create a tag successfully", async () => {
      const params: CreateTagParams = {
        name: testName,
        content: testContent,
        attachment: null,
        guildId: testGuildId,
        ownerId: testUserId,
      };

      const result = await tagService.createTag(params);

      expect(result.ok).toBe(true);
      expect(result.val).toBeInstanceOf(Tag);
      expect(mockRepository.size()).toBe(1);

      const tag = result.val as Tag;
      expect(tag.getName().getValue()).toBe(testName);
      expect(tag.getContent()).toBe(testContent);
      expect(tag.getGuildId()).toBe(testGuildId);
      expect(tag.getOwnerId()).toBe(testUserId);
      expect(tag.getUseCount()).toBe(BigInt(0));
    });

    it("should create a tag with attachment only", async () => {
      const params: CreateTagParams = {
        name: testName,
        content: null,
        attachment: "https://example.com/image.png",
        guildId: testGuildId,
        ownerId: testUserId,
      };

      const result = await tagService.createTag(params);

      expect(result.ok).toBe(true);
      const tag = result.val as Tag;
      expect(tag.getContent()).toBe(null);
      expect(tag.getAttachment()).toBe("https://example.com/image.png");
    });

    it("should fail to create tag with invalid name", async () => {
      const params: CreateTagParams = {
        name: "invalid name with spaces",
        content: testContent,
        attachment: null,
        guildId: testGuildId,
        ownerId: testUserId,
      };

      const result = await tagService.createTag(params);

      expect(result.err).toBe(true);
      expect(result.val).toContain("invalid characters");
      expect(mockRepository.size()).toBe(0);
    });

    it("should fail to create tag with empty name", async () => {
      const params: CreateTagParams = {
        name: "",
        content: testContent,
        attachment: null,
        guildId: testGuildId,
        ownerId: testUserId,
      };

      const result = await tagService.createTag(params);

      expect(result.err).toBe(true);
      expect(result.val).toContain("too short");
      expect(mockRepository.size()).toBe(0);
    });

    it("should fail to create tag with name too long", async () => {
      const params: CreateTagParams = {
        name: "a".repeat(33),
        content: testContent,
        attachment: null,
        guildId: testGuildId,
        ownerId: testUserId,
      };

      const result = await tagService.createTag(params);

      expect(result.err).toBe(true);
      expect(result.val).toContain("too long");
      expect(mockRepository.size()).toBe(0);
    });

    it("should fail to create duplicate tag", async () => {
      // Create first tag
      mockRepository.addTag({
        name: testName,
        content: testContent,
        attachment: null,
        guildId: testGuildId,
        ownerId: testUserId,
        useCount: BigInt(0),
        created: new Date(),
      });

      const params: CreateTagParams = {
        name: testName,
        content: "Different content",
        attachment: null,
        guildId: testGuildId,
        ownerId: testUserId,
      };

      const result = await tagService.createTag(params);

      expect(result.err).toBe(true);
      expect(result.val).toBe(`Tag '${testName}' already exists`);
      expect(mockRepository.size()).toBe(1);
    });

    it("should allow same tag name in different guilds", async () => {
      // Create tag in first guild
      mockRepository.addTag({
        name: testName,
        content: testContent,
        attachment: null,
        guildId: testGuildId,
        ownerId: testUserId,
        useCount: BigInt(0),
        created: new Date(),
      });

      const params: CreateTagParams = {
        name: testName,
        content: testContent,
        attachment: null,
        guildId: "different-guild",
        ownerId: testUserId,
      };

      const result = await tagService.createTag(params);

      expect(result.ok).toBe(true);
      expect(mockRepository.size()).toBe(2);
    });
  });

  describe("getTag", () => {
    beforeEach(() => {
      mockRepository.addTag({
        name: testName,
        content: testContent,
        attachment: null,
        guildId: testGuildId,
        ownerId: testUserId,
        useCount: BigInt(0),
        created: new Date(),
      });
    });

    it("should retrieve an existing tag", async () => {
      const tag = await tagService.getTag(testName, testGuildId);

      expect(tag).not.toBe(null);

      if (!tag) {
        throw new Error("Tag should not be null");
      }

      expect(tag.getName().getValue()).toBe(testName);
      expect(tag.getContent()).toBe(testContent);
    });

    it("should return null for non-existent tag", async () => {
      const tag = await tagService.getTag("non-existent", testGuildId);

      expect(tag).toBe(null);
    });

    it("should return null for tag in wrong guild", async () => {
      const tag = await tagService.getTag(testName, "wrong-guild");

      expect(tag).toBe(null);
    });

    it("should return null for invalid tag name", async () => {
      const tag = await tagService.getTag("invalid name", testGuildId);

      expect(tag).toBe(null);
    });
  });

  describe("useTag", () => {
    let existingTag: Tag;

    beforeEach(() => {
      existingTag = mockRepository.addTag({
        name: testName,
        content: testContent,
        attachment: null,
        guildId: testGuildId,
        ownerId: testUserId,
        useCount: BigInt(5),
        created: new Date(),
      });
    });

    it("should increment use count and return tag", async () => {
      const result = await tagService.useTag(testName, testGuildId);

      expect(result.ok).toBe(true);
      const tag = result.val as Tag;
      expect(tag.getUseCount()).toBe(BigInt(6));
      expect(tag).toEqual(existingTag);
    });

    it("should fail for non-existent tag", async () => {
      const result = await tagService.useTag("non-existent", testGuildId);

      expect(result.err).toBe(true);
      expect(result.val).toBe("Tag 'non-existent' not found");
    });

    it("should fail for invalid tag name", async () => {
      const result = await tagService.useTag("invalid name", testGuildId);

      expect(result.err).toBe(true);
      expect(result.val).toBe("Tag 'invalid name' not found");
    });
  });

  describe("updateTag", () => {
    const anotherUserId = "111111111";

    beforeEach(() => {
      mockRepository.addTag({
        name: testName,
        content: testContent,
        attachment: null,
        guildId: testGuildId,
        ownerId: testUserId,
        useCount: BigInt(0),
        created: new Date(),
      });
    });

    it("should update tag content when user is owner", async () => {
      const newContent = "Updated content";
      const params: UpdateTagParams = {
        name: testName,
        guildId: testGuildId,
        userId: testUserId,
        hasManageGuildPermission: false,
        newContent,
      };

      const result = await tagService.updateTag(params);

      expect(result.ok).toBe(true);
      const tag = result.val as Tag;
      expect(tag.getContent()).toBe(newContent);
    });

    it("should update tag content when user has manage guild permission", async () => {
      const newContent = "Updated by admin";
      const params: UpdateTagParams = {
        name: testName,
        guildId: testGuildId,
        userId: anotherUserId,
        hasManageGuildPermission: true,
        newContent,
      };

      const result = await tagService.updateTag(params);

      expect(result.ok).toBe(true);
      const tag = result.val as Tag;
      expect(tag.getContent()).toBe(newContent);
    });

    it("should update tag attachment", async () => {
      const newAttachment = "https://example.com/new-image.png";
      const params: UpdateTagParams = {
        name: testName,
        guildId: testGuildId,
        userId: testUserId,
        hasManageGuildPermission: false,
        newAttachment,
      };

      const result = await tagService.updateTag(params);

      expect(result.ok).toBe(true);
      const tag = result.val as Tag;
      expect(tag.getAttachment()).toBe(newAttachment);
      expect(tag.getContent()).toBe(testContent); // Should preserve existing content
    });

    it("should fail when user lacks permission", async () => {
      const params: UpdateTagParams = {
        name: testName,
        guildId: testGuildId,
        userId: anotherUserId,
        hasManageGuildPermission: false,
        newContent: "Unauthorized update",
      };

      const result = await tagService.updateTag(params);

      expect(result.err).toBe(true);
      expect(result.val).toBe("You don't have permission to edit this tag");
    });

    it("should fail for non-existent tag", async () => {
      const params: UpdateTagParams = {
        name: "non-existent",
        guildId: testGuildId,
        userId: testUserId,
        hasManageGuildPermission: false,
        newContent: "New content",
      };

      const result = await tagService.updateTag(params);

      expect(result.err).toBe(true);
      expect(result.val).toBe("Tag 'non-existent' not found");
    });

    it("should fail when no new content or attachment provided", async () => {
      const params: UpdateTagParams = {
        name: testName,
        guildId: testGuildId,
        userId: testUserId,
        hasManageGuildPermission: false,
      };

      const result = await tagService.updateTag(params);

      expect(result.err).toBe(true);
      expect(result.val).toBe(
        "Must provide either new content or new attachment",
      );
    });
  });

  describe("renameTag", () => {
    const anotherUserId = "111111111";
    const newName = "renamed-tag";

    beforeEach(() => {
      mockRepository.addTag({
        name: testName,
        content: testContent,
        attachment: null,
        guildId: testGuildId,
        ownerId: testUserId,
        useCount: BigInt(5),
        created: new Date(),
      });
    });

    it("should rename tag when user is owner", async () => {
      const params: RenameTagParams = {
        currentName: testName,
        newName,
        guildId: testGuildId,
        userId: testUserId,
        hasManageGuildPermission: false,
      };

      const result = await tagService.renameTag(params);

      expect(result.ok).toBe(true);
      const tag = result.val as Tag;
      expect(tag.getName().getValue()).toBe(newName);
      expect(tag.getContent()).toBe(testContent);
      expect(tag.getUseCount()).toBe(BigInt(5));

      // Original tag should be deleted
      const originalTag = await tagService.getTag(testName, testGuildId);
      expect(originalTag).toBe(null);
    });

    it("should rename tag when user has manage guild permission", async () => {
      const params: RenameTagParams = {
        currentName: testName,
        newName,
        guildId: testGuildId,
        userId: anotherUserId,
        hasManageGuildPermission: true,
      };

      const result = await tagService.renameTag(params);

      expect(result.ok).toBe(true);
      const tag = result.val as Tag;
      expect(tag.getName().getValue()).toBe(newName);
    });

    it("should fail when user lacks permission", async () => {
      const params: RenameTagParams = {
        currentName: testName,
        newName,
        guildId: testGuildId,
        userId: anotherUserId,
        hasManageGuildPermission: false,
      };

      const result = await tagService.renameTag(params);

      expect(result.err).toBe(true);
      expect(result.val).toBe("You don't have permission to rename this tag");
    });

    it("should fail for non-existent tag", async () => {
      const params: RenameTagParams = {
        currentName: "non-existent",
        newName,
        guildId: testGuildId,
        userId: testUserId,
        hasManageGuildPermission: false,
      };

      const result = await tagService.renameTag(params);

      expect(result.err).toBe(true);
      expect(result.val).toBe("Tag 'non-existent' not found");
    });

    it("should fail when new name is invalid", async () => {
      const params: RenameTagParams = {
        currentName: testName,
        newName: "invalid name with spaces",
        guildId: testGuildId,
        userId: testUserId,
        hasManageGuildPermission: false,
      };

      const result = await tagService.renameTag(params);

      expect(result.err).toBe(true);
      expect(result.val).toContain("invalid characters");
    });

    it("should fail when new name conflicts with existing tag", async () => {
      // Create another tag with the target name
      mockRepository.addTag({
        name: newName,
        content: "Different content",
        attachment: null,
        guildId: testGuildId,
        ownerId: anotherUserId,
        useCount: BigInt(0),
        created: new Date(),
      });

      const params: RenameTagParams = {
        currentName: testName,
        newName,
        guildId: testGuildId,
        userId: testUserId,
        hasManageGuildPermission: false,
      };

      const result = await tagService.renameTag(params);

      expect(result.err).toBe(true);
      expect(result.val).toBe(`Tag '${newName}' already exists`);
    });
  });

  describe("deleteTag", () => {
    const anotherUserId = "111111111";

    beforeEach(() => {
      mockRepository.addTag({
        name: testName,
        content: testContent,
        attachment: null,
        guildId: testGuildId,
        ownerId: testUserId,
        useCount: BigInt(0),
        created: new Date(),
      });
    });

    it("should delete tag when user is owner", async () => {
      const params: DeleteTagParams = {
        name: testName,
        guildId: testGuildId,
        userId: testUserId,
        hasManageGuildPermission: false,
      };

      const result = await tagService.deleteTag(params);

      expect(result.ok).toBe(true);
      const deletedTag = result.val as Tag;
      expect(deletedTag.getName().getValue()).toBe(testName);
      expect(mockRepository.size()).toBe(0);
    });

    it("should delete tag when user has manage guild permission", async () => {
      const params: DeleteTagParams = {
        name: testName,
        guildId: testGuildId,
        userId: anotherUserId,
        hasManageGuildPermission: true,
      };

      const result = await tagService.deleteTag(params);

      expect(result.ok).toBe(true);
      expect(mockRepository.size()).toBe(0);
    });

    it("should fail when user lacks permission", async () => {
      const params: DeleteTagParams = {
        name: testName,
        guildId: testGuildId,
        userId: anotherUserId,
        hasManageGuildPermission: false,
      };

      const result = await tagService.deleteTag(params);

      expect(result.err).toBe(true);
      expect(result.val).toBe("You don't have permission to delete this tag");
      expect(mockRepository.size()).toBe(1);
    });

    it("should fail for non-existent tag", async () => {
      const params: DeleteTagParams = {
        name: "non-existent",
        guildId: testGuildId,
        userId: testUserId,
        hasManageGuildPermission: false,
      };

      const result = await tagService.deleteTag(params);

      expect(result.err).toBe(true);
      expect(result.val).toBe("Tag 'non-existent' not found");
    });
  });
});
