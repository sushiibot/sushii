import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import { TagName } from "../value-objects/TagName";

export interface TagData {
  name: string;
  content: string | null;
  attachment: string | null;
  guildId: string;
  ownerId: string;
  useCount: bigint;
  created: Date;
}

export class Tag {
  private constructor(
    private readonly name: TagName,
    private content: string | null,
    private attachment: string | null,
    private readonly guildId: string,
    private readonly ownerId: string,
    private useCount: bigint,
    private readonly created: Date,
  ) {}

  static create(data: TagData): Result<Tag, string> {
    const nameResult = TagName.create(data.name);
    if (nameResult.err) {
      return Err(nameResult.val);
    }

    if (!data.content && !data.attachment) {
      return Err("Tag must have either content or attachment");
    }

    return Ok(
      new Tag(
        nameResult.val,
        data.content,
        data.attachment,
        data.guildId,
        data.ownerId,
        data.useCount,
        data.created,
      ),
    );
  }

  getName(): TagName {
    return this.name;
  }

  getContent(): string | null {
    return this.content;
  }

  getAttachment(): string | null {
    return this.attachment;
  }

  getGuildId(): string {
    return this.guildId;
  }

  getOwnerId(): string {
    return this.ownerId;
  }

  getUseCount(): bigint {
    return this.useCount;
  }

  getCreated(): Date {
    return this.created;
  }

  updateContent(
    content: string | null,
    attachment: string | null,
  ): Result<void, string> {
    if (!content && !attachment) {
      return Err("Tag must have either content or attachment");
    }

    this.content = content;
    this.attachment = attachment;

    return Ok(undefined);
  }

  hasContent(): boolean {
    return this.content !== null && this.content.length > 0;
  }

  hasAttachment(): boolean {
    return this.attachment !== null;
  }

  incrementUseCount(): void {
    this.useCount = this.useCount + BigInt(1);
  }

  isOwnedBy(userId: string): boolean {
    return this.ownerId === userId;
  }

  canBeModifiedBy(userId: string, hasManageGuildPermission: boolean): boolean {
    return this.isOwnedBy(userId) || hasManageGuildPermission;
  }

  toData(): TagData {
    return {
      name: this.name.getValue(),
      content: this.content,
      attachment: this.attachment,
      guildId: this.guildId,
      ownerId: this.ownerId,
      useCount: this.useCount,
      created: this.created,
    };
  }

  getDisplayContent(): string {
    let displayContent = this.content || "";

    if (this.attachment) {
      displayContent += this.attachment;
    }

    return displayContent;
  }
}
