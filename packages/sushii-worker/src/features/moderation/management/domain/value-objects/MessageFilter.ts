import { Message, User } from "discord.js";

export enum PruneAttachmentsOption {
  WithAttachments = "with_attachments",
  WithoutAttachments = "without_attachments",
}

export enum PruneBotsOrUsersOption {
  BotsOnly = "bots_only",
  UsersOnly = "users_only",
}

export interface MessageFilterCriteria {
  beforeMessageID: string | null;
  afterMessageID: string | null;
  user: User | null;
  maxDeleteCount: number | null;
  skipPinned: boolean | null;
  attachments: string | null;
  botsOrUsers: string | null;
}

export interface FilterResult {
  filteredMessages: Message[];
  userDeletedSummary: Record<string, number>;
}

export class MessageFilter {
  constructor(private readonly criteria: MessageFilterCriteria) {}

  static create(criteria: MessageFilterCriteria): MessageFilter {
    return new MessageFilter(criteria);
  }

  filter(messages: Message[]): FilterResult {
    const {
      afterMessageID,
      beforeMessageID,
      skipPinned,
      user,
      attachments,
      botsOrUsers,
      maxDeleteCount,
    } = this.criteria;

    const filteredMsgs = messages.filter((msg) => {
      if (skipPinned && msg.pinned) {
        return false;
      }

      if (user && msg.author.id !== user.id) {
        return false;
      }

      // Skip no attachments
      if (
        attachments === PruneAttachmentsOption.WithAttachments &&
        msg.attachments.size === 0
      ) {
        return false;
      }

      // Skip with attachments
      if (
        attachments === PruneAttachmentsOption.WithoutAttachments &&
        msg.attachments.size > 0
      ) {
        return false;
      }

      // Bots only, but user is not a bot, skip
      if (botsOrUsers === PruneBotsOrUsersOption.BotsOnly && !msg.author.bot) {
        return false;
      }

      // Users only, but user is a bot, skip
      if (botsOrUsers === PruneBotsOrUsersOption.UsersOnly && msg.author.bot) {
        return false;
      }

      const msgIDBigInt = BigInt(msg.id);
      // All message IDs must be smaller than before message ID
      if (beforeMessageID && msgIDBigInt >= BigInt(beforeMessageID)) {
        return false;
      }

      // All message IDs must be larger than after message ID
      if (afterMessageID && msgIDBigInt <= BigInt(afterMessageID)) {
        return false;
      }

      return true;
    });

    const trimmedMsgs = filteredMsgs.slice(0, maxDeleteCount || 100);

    const userDeletedSummary = trimmedMsgs.reduce(
      (acc, msg) => {
        if (acc[msg.author.id]) {
          acc[msg.author.id] += 1;
        } else {
          acc[msg.author.id] = 1;
        }

        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      filteredMessages: trimmedMsgs,
      userDeletedSummary,
    };
  }

  get beforeMessageID(): string | null {
    return this.criteria.beforeMessageID;
  }

  get afterMessageID(): string | null {
    return this.criteria.afterMessageID;
  }
}
