import type { MessageLogEvent } from "../entities/MessageLogEvent";

export interface MessageLogEventRepository {
  save(event: MessageLogEvent): Promise<void>;
  findByMessageIds(messageIds: string[]): Promise<MessageLogEvent[]>;
  deleteMessagesBefore(date: Date): Promise<number>;
}
