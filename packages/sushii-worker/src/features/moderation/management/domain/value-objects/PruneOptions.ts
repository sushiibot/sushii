import type { User } from "discord.js";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

const RE_MESSAGE_ID = /^\d{17,21}$/;
const RE_MESSAGE_ID_FROM_URL = /channels\/\d{17,21}\/\d{17,21}\/(\d{17,21})$/;

export interface PruneConfiguration {
  maxDeleteCount: number;
  afterMessageID: string | null;
  beforeMessageID: string | null;
  user: User | null;
  skipPinned: boolean | null;
  attachments: string | null;
  botsOrUsers: string | null;
}

export class PruneOptions {
  private constructor(private readonly config: PruneConfiguration) {}

  static create(
    maxDeleteCount: number,
    afterMessageIDStr: string | null,
    beforeMessageIDStr: string | null,
    user: User | null,
    skipPinned: boolean | null,
    attachments: string | null,
    botsOrUsers: string | null,
  ): Result<PruneOptions, string> {
    // Validate max delete count
    if (maxDeleteCount < 2 || maxDeleteCount > 100) {
      return Err("Max delete count must be between 2 and 100");
    }

    // Parse message IDs
    const afterMessageID = afterMessageIDStr
      ? this.getMessageID(afterMessageIDStr)
      : null;
    const beforeMessageID = beforeMessageIDStr
      ? this.getMessageID(beforeMessageIDStr)
      : null;

    // Validate message ID formats
    if (afterMessageIDStr && !afterMessageID) {
      return Err("Invalid after message ID format");
    }

    if (beforeMessageIDStr && !beforeMessageID) {
      return Err("Invalid before message ID format");
    }

    // Validate message ID relationship
    if (afterMessageID && beforeMessageID) {
      if (BigInt(afterMessageID) > BigInt(beforeMessageID)) {
        return Err("After message ID must be older than before message ID");
      }
    }

    return Ok(
      new PruneOptions({
        maxDeleteCount,
        afterMessageID,
        beforeMessageID,
        user,
        skipPinned,
        attachments,
        botsOrUsers,
      }),
    );
  }

  private static getMessageIDFromURL(url: string): string | null {
    const match = url.match(RE_MESSAGE_ID_FROM_URL);
    if (!match) {
      return null;
    }

    return match[1];
  }

  private static getMessageIDPlain(id: string): string | null {
    const match = id.match(RE_MESSAGE_ID);
    if (!match) {
      return null;
    }

    return match[0];
  }

  private static getMessageID(s: string): string | null {
    return this.getMessageIDFromURL(s) || this.getMessageIDPlain(s);
  }

  get maxDeleteCount(): number {
    return this.config.maxDeleteCount;
  }

  get afterMessageID(): string | null {
    return this.config.afterMessageID;
  }

  get beforeMessageID(): string | null {
    return this.config.beforeMessageID;
  }

  get user(): User | null {
    return this.config.user;
  }

  get skipPinned(): boolean | null {
    return this.config.skipPinned;
  }

  get attachments(): string | null {
    return this.config.attachments;
  }

  get botsOrUsers(): string | null {
    return this.config.botsOrUsers;
  }

  getFetchOptions() {
    return {
      limit: 100,
      // Use after if it is provided
      after: this.afterMessageID || undefined,
      // If before is provided, only use it if after is not provided
      // Assumption: Most cases will not have 100 messages old, so providing
      // after instead of before will return < 100 messages.
      before:
        this.afterMessageID === null && this.beforeMessageID
          ? this.beforeMessageID
          : undefined,
    };
  }
}
