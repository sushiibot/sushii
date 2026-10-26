import type { Logger } from "pino";

import type { MessageLogBlock } from "@/features/message-log/domain/entities/MessageLogBlock";
import type { MessageLogBlockRepository } from "@/features/message-log/domain/repositories/MessageLogBlockRepository";

export class MessageLogBlockService {
  constructor(
    private readonly messageLogBlockRepository: MessageLogBlockRepository,
    private readonly logger: Logger,
  ) {}

  async getIgnoredChannels(guildId: string): Promise<MessageLogBlock[]> {
    return this.messageLogBlockRepository.findByGuildId(guildId);
  }

  async setIgnoredChannels(
    guildId: string,
    channelIds: string[],
  ): Promise<void> {
    const current = new Set(
      (await this.getIgnoredChannels(guildId)).map((b) => b.channelId),
    );
    const desired = new Set(channelIds);

    const toAdd = [...desired].filter((id) => !current.has(id));
    const toRemove = [...current].filter((id) => !desired.has(id));

    this.logger.info(
      { guildId, added: toAdd.length, removed: toRemove.length },
      "Setting ignored channels",
    );

    for (const channelId of toAdd) {
      await this.messageLogBlockRepository.addBlock(guildId, channelId);
    }

    for (const channelId of toRemove) {
      await this.messageLogBlockRepository.removeBlock(guildId, channelId);
    }
  }
}
