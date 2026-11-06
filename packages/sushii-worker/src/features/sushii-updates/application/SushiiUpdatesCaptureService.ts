import { MessageFlags, MessageType, SnowflakeUtil } from "discord.js";
import type { Logger } from "pino";

import type { SushiiUpdatesRepository } from "../domain/SushiiUpdatesRepository";
import { PUBLISH_WINDOW_MS } from "../domain/UpdatePost";
import type { SushiiUpdatesMetrics } from "../infrastructure/SushiiUpdatesMetrics";

export interface SourceMessage {
  id: string;
  flags: number;
  type: MessageType;
  authorId: string;
}

/** A user's announcement that was published recently, as opposed to an edit of an old one. */
export function isPublishedUpdate(
  message: SourceMessage,
  botUserId: string,
  now: number = Date.now(),
): boolean {
  if ((message.flags & MessageFlags.Crossposted) === 0) {
    return false;
  }
  if (
    message.type !== MessageType.Default &&
    message.type !== MessageType.Reply
  ) {
    return false;
  }
  if (message.authorId === botUserId) {
    return false;
  }
  return now - SnowflakeUtil.timestampFrom(message.id) <= PUBLISH_WINDOW_MS;
}

export class SushiiUpdatesCaptureService {
  constructor(
    private readonly repository: Pick<SushiiUpdatesRepository, "savePost">,
    private readonly metrics: SushiiUpdatesMetrics,
    private readonly logger: Logger,
  ) {}

  /** Idempotent on the message ID, so edits of a published post never queue it again. */
  async capture(message: SourceMessage, botUserId: string): Promise<boolean> {
    if (!isPublishedUpdate(message, botUserId)) {
      return false;
    }
    const stored = await this.repository.savePost({
      messageId: message.id,
      createdAt: new Date(SnowflakeUtil.timestampFrom(message.id)),
    });
    if (stored) {
      this.metrics.recordPostCaptured();
      this.logger.info(
        { messageId: message.id },
        "Captured sushii updates post",
      );
    }
    return stored;
  }
}
