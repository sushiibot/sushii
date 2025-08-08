import { XpBlock } from "../entities/XpBlock";

export interface XpBlockRepository {
  findActiveBlocks(
    guildId: string,
    channelId: string,
    roleIds: string[],
  ): Promise<XpBlock[]>;

  findByGuildId(guildId: string): Promise<XpBlock[]>;

  findChannelBlocksByGuildId(guildId: string): Promise<string[]>;

  findRoleBlocksByGuildId(guildId: string): Promise<string[]>;

  create(xpBlock: XpBlock): Promise<XpBlock | null>;

  delete(guildId: string, blockId: string): Promise<XpBlock | null>;
}
