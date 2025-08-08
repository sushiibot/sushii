import type { Client, Message, TextBasedChannel } from "discord.js";
import { DiscordAPIError } from "discord.js";
import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type {
  MessageFilterCriteria} from "../domain/value-objects/MessageFilter";
import {
  MessageFilter
} from "../domain/value-objects/MessageFilter";
import type { PruneOptions } from "../domain/value-objects/PruneOptions";

export interface PruneResult {
  deletedCount: number;
  userDeletedSummary: Record<string, number>;
  afterMessageID: string | null;
  beforeMessageID: string | null;
}

export class PruneMessageService {
  constructor(
    private readonly client: Client,
    private readonly logger: Logger,
  ) {}

  async pruneMessages(
    channel: TextBasedChannel,
    options: PruneOptions,
  ): Promise<Result<PruneResult, string>> {
    this.logger.debug(
      {
        channelId: channel.id,
        maxDeleteCount: options.maxDeleteCount,
        afterMessageID: options.afterMessageID,
        beforeMessageID: options.beforeMessageID,
        userTargeted: options.user?.id,
      },
      "Starting message prune operation",
    );

    // Fetch messages based on options
    const fetchResult = await this.fetchMessages(channel, options);
    if (fetchResult.err) {
      return fetchResult;
    }

    const messages = fetchResult.val;

    // Filter messages based on criteria
    const filterCriteria: MessageFilterCriteria = {
      beforeMessageID: options.beforeMessageID,
      afterMessageID: options.afterMessageID,
      user: options.user,
      maxDeleteCount: options.maxDeleteCount,
      skipPinned: options.skipPinned,
      attachments: options.attachments,
      botsOrUsers: options.botsOrUsers,
    };

    const messageFilter = MessageFilter.create(filterCriteria);
    const { filteredMessages, userDeletedSummary } =
      messageFilter.filter(messages);

    this.logger.debug(
      {
        channelId: channel.id,
        totalFetched: messages.length,
        afterFiltering: filteredMessages.length,
        filteredMessages: filteredMessages.map((m) => ({
          id: m.id,
          authorId: m.author.id,
        })),
      },
      "Messages filtered for deletion",
    );

    // Perform bulk deletion
    const deleteResult = await this.bulkDeleteMessages(
      channel,
      filteredMessages,
    );
    if (deleteResult.err) {
      return deleteResult;
    }

    const result: PruneResult = {
      deletedCount: filteredMessages.length,
      userDeletedSummary,
      afterMessageID: options.afterMessageID,
      beforeMessageID: options.beforeMessageID,
    };

    this.logger.info(
      {
        channelId: channel.id,
        deletedCount: result.deletedCount,
        userSummary: userDeletedSummary,
      },
      "Successfully completed message prune operation",
    );

    return Ok(result);
  }

  private async fetchMessages(
    channel: TextBasedChannel,
    options: PruneOptions,
  ): Promise<Result<Message[], string>> {
    try {
      const msgsCol = await channel.messages.fetch(options.getFetchOptions());

      // Ensure messages are ordered (newest first)
      const msgs = Array.from(msgsCol.values());
      msgs.sort((a, b) => {
        if (BigInt(a.id) < BigInt(b.id)) {
          return 1;
        }

        if (BigInt(a.id) > BigInt(b.id)) {
          return -1;
        }

        return 0;
      });

      this.logger.debug(
        {
          channelId: channel.id,
          fetchedCount: msgs.length,
        },
        "Successfully fetched messages for prune operation",
      );

      return Ok(msgs);
    } catch (err) {
      if (err instanceof DiscordAPIError) {
        this.logger.warn(
          {
            channelId: channel.id,
            error: err.message,
            code: err.code,
          },
          "Discord API error while fetching messages",
        );
        return Err(`Failed to fetch messages: ${err.message}`);
      }

      this.logger.error(
        {
          channelId: channel.id,
          error: err,
        },
        "Unexpected error while fetching messages",
      );
      return Err("Unexpected error while fetching messages");
    }
  }

  private async bulkDeleteMessages(
    channel: TextBasedChannel,
    messages: Message[],
  ): Promise<Result<void, string>> {
    if (messages.length === 0) {
      return Ok(undefined);
    }

    if (!channel.isTextBased() || channel.isDMBased()) {
      return Err("Channel is not text-based");
    }

    try {
      await channel.bulkDelete(messages.map((m) => m.id));

      this.logger.debug(
        {
          channelId: channel.id,
          deletedCount: messages.length,
        },
        "Successfully bulk deleted messages",
      );

      return Ok(undefined);
    } catch (err) {
      if (err instanceof DiscordAPIError) {
        this.logger.warn(
          {
            channelId: channel.id,
            error: err.message,
            code: err.code,
            messageCount: messages.length,
          },
          "Discord API error while deleting messages",
        );

        return Err(`Failed to delete messages: ${err.message}`);
      }

      this.logger.error(
        {
          channelId: channel.id,
          error: err,
          messageCount: messages.length,
        },
        "Unexpected error while deleting messages",
      );

      return Err("Unexpected error while deleting messages");
    }
  }
}
