import { UserLevel } from "../domain/entities/UserLevel";
import type { LevelRoleRepository } from "../domain/repositories/LevelRoleRepository";
import type { UserLevelRepository } from "../domain/repositories/UserLevelRepository";
import type { XpBlockRepository } from "../domain/repositories/XpBlockRepository";

export interface UpdateUserXpResult {
  oldLevel: number | null;
  newLevel: number | null;
  addRoleIds: string[] | null;
  removeRoleIds: string[] | null;
}

export class UpdateUserXpService {
  constructor(
    private readonly userLevelRepository: UserLevelRepository,
    private readonly levelRoleRepository: LevelRoleRepository,
    private readonly xpBlockRepository: XpBlockRepository,
  ) {}

  async execute(
    guildId: string,
    channelId: string,
    userId: string,
    roleIds: string[],
  ): Promise<UpdateUserXpResult> {
    const xpBlocks = await this.xpBlockRepository.findActiveBlocks(
      guildId,
      channelId,
      roleIds,
    );

    if (xpBlocks.length > 0) {
      return {
        oldLevel: null,
        newLevel: null,
        addRoleIds: null,
        removeRoleIds: null,
      };
    }

    let userLevel = await this.userLevelRepository.findByUserAndGuild(
      userId,
      guildId,
    );

    const currentTime = new Date();

    if (!userLevel) {
      userLevel = UserLevel.create(userId, guildId, 5, currentTime);
      await this.userLevelRepository.create(userLevel);

      const newLevel = userLevel.getCurrentLevel();
      const { addRoleIds, removeRoleIds } = await this.calculateRoleChanges(
        guildId,
        0,
        newLevel,
      );

      return {
        oldLevel: 0,
        newLevel,
        addRoleIds,
        removeRoleIds,
      };
    }

    if (!userLevel.canGainXp()) {
      return {
        oldLevel: null,
        newLevel: null,
        addRoleIds: null,
        removeRoleIds: null,
      };
    }

    const oldLevel = userLevel.addXp(5, currentTime);
    const newLevel = userLevel.getCurrentLevel();

    await this.userLevelRepository.save(userLevel);

    const { addRoleIds, removeRoleIds } = await this.calculateRoleChanges(
      guildId,
      oldLevel,
      newLevel,
    );

    return {
      oldLevel,
      newLevel,
      addRoleIds,
      removeRoleIds,
    };
  }

  private async calculateRoleChanges(
    guildId: string,
    oldLevel: number,
    newLevel: number,
  ): Promise<{ addRoleIds: string[] | null; removeRoleIds: string[] | null }> {
    const levelRoles = await this.levelRoleRepository.findByGuild(guildId);

    const addRoleIds: string[] = [];
    const removeRoleIds: string[] = [];

    for (const levelRole of levelRoles) {
      if (levelRole.shouldAddRole(newLevel)) {
        addRoleIds.push(levelRole.getRoleId());
      }

      if (levelRole.shouldRemoveRole(newLevel)) {
        removeRoleIds.push(levelRole.getRoleId());
      }
    }

    return {
      addRoleIds: addRoleIds.length > 0 ? addRoleIds : null,
      removeRoleIds: removeRoleIds.length > 0 ? removeRoleIds : null,
    };
  }
}
