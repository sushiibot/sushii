import type { MessageLogBlock } from "../entities/MessageLogBlock";

export interface MessageLogBlockRepository {
  findByGuildId(guildId: string): Promise<MessageLogBlock[]>;
  findByGuildAndChannel(
    guildId: string,
    channelId: string,
  ): Promise<MessageLogBlock | null>;
  addBlock(guildId: string, channelId: string): Promise<void>;
  removeBlock(guildId: string, channelId: string): Promise<void>;
}
