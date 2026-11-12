import type { MessageLogEvent } from "../entities/MessageLogEvent";

export interface MessageLogEventRepository {
  save(event: MessageLogEvent): Promise<void>;
  /** Updates an already-cached row only; returns false when nothing was cached or nothing changed. */
  updateIfChanged(event: MessageLogEvent): Promise<boolean>;
  findByMessageIds(messageIds: string[]): Promise<MessageLogEvent[]>;
  deleteMessagesBefore(date: Date): Promise<number>;
}
