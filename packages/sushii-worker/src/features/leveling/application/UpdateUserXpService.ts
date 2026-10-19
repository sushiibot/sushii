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

const NO_CHANGE: UpdateUserXpResult = {
  oldLevel: null,
  newLevel: null,
  addRoleIds: null,
  removeRoleIds: null,
};

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
      return NO_CHANGE;
    }

    const currentTime = new Date();
    const userLevel = await this.userLevelRepository.findByUserAndGuild(
      userId,
      guildId,
    );

    if (!userLevel) {
      const newUserLevel = UserLevel.create(userId, guildId, 5, currentTime);
      const created = await this.userLevelRepository.create(newUserLevel);

      // A concurrent message created the row first; this message falls within
      // that message's cooldown, so it earns nothing.
      if (!created) {
        return NO_CHANGE;
      }

      return this.buildResult(guildId, 0, newUserLevel.getCurrentLevel());
    }

    if (!userLevel.canGainXp(currentTime)) {
      return NO_CHANGE;
    }

    const oldLevel = userLevel.addXp(5, currentTime);
    const newLevel = userLevel.getCurrentLevel();

    await this.userLevelRepository.save(userLevel);

    return this.buildResult(guildId, oldLevel, newLevel);
  }

  private async buildResult(
    guildId: string,
    oldLevel: number,
    newLevel: number,
  ): Promise<UpdateUserXpResult> {
    // Only sync level roles on a level change, so roles removed manually by
    // admins are not re-added on every XP gain.
    if (oldLevel === newLevel) {
      return { oldLevel, newLevel, addRoleIds: null, removeRoleIds: null };
    }

    const { addRoleIds, removeRoleIds } = await this.calculateRoleChanges(
      guildId,
      newLevel,
    );

    return { oldLevel, newLevel, addRoleIds, removeRoleIds };
  }

  private async calculateRoleChanges(
    guildId: string,
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
