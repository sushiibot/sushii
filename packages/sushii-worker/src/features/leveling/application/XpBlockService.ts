import { Logger } from "pino";

import { XpBlock } from "../domain/entities/XpBlock";
import { XpBlockRepository } from "../domain/repositories/XpBlockRepository";

export class XpBlockService {
  constructor(
    private readonly xpBlockRepository: XpBlockRepository,
    private readonly logger: Logger,
  ) {}

  async blockChannel(guildId: string, channelId: string): Promise<boolean> {
    const xpBlock = XpBlock.createChannelBlock(guildId, channelId);
    const result = await this.xpBlockRepository.create(xpBlock);
    const success = result !== null;

    this.logger.info(
      { guildId, channelId, blockType: "channel", success },
      success
        ? "XP block created for channel"
        : "XP block already exists for channel",
    );

    return success;
  }

  async blockRole(guildId: string, roleId: string): Promise<boolean> {
    const xpBlock = XpBlock.createRoleBlock(guildId, roleId);
    const result = await this.xpBlockRepository.create(xpBlock);
    const success = result !== null;

    this.logger.info(
      { guildId, roleId, blockType: "role", success },
      success ? "XP block created for role" : "XP block already exists for role",
    );

    return success;
  }

  async unblock(guildId: string, blockId: string): Promise<boolean> {
    const result = await this.xpBlockRepository.delete(guildId, blockId);
    const success = result !== null;

    this.logger.info(
      { guildId, blockId, success },
      success ? "XP block removed" : "XP block not found",
    );

    return success;
  }

  async getChannelBlocks(guildId: string): Promise<string[]> {
    const channelIds = await this.xpBlockRepository.findChannelBlocksByGuildId(
      guildId,
    );

    this.logger.debug(
      { guildId, channelBlockCount: channelIds.length },
      "Retrieved channel XP blocks",
    );

    return channelIds;
  }

  async getRoleBlocks(guildId: string): Promise<string[]> {
    const roleIds = await this.xpBlockRepository.findRoleBlocksByGuildId(
      guildId,
    );

    this.logger.debug(
      { guildId, roleBlockCount: roleIds.length },
      "Retrieved role XP blocks",
    );

    return roleIds;
  }
}