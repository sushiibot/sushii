import type { ChatInputCommandInteraction, Role } from "discord.js";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import { LevelRole } from "../domain/entities/LevelRole";
import type { LevelRoleRepository } from "../domain/repositories/LevelRoleRepository";

export class LevelRoleService {
  constructor(private readonly levelRoleRepository: LevelRoleRepository) {}

  async createLevelRole(
    interaction: ChatInputCommandInteraction<"cached">,
    role: Role,
    addLevel: number,
    removeLevel?: number,
  ): Promise<Result<LevelRole, string>> {
    // Input validation
    if (addLevel < 1 || addLevel > 500) {
      return Err("The add level must be between 1 and 500.");
    }
    
    if (removeLevel !== undefined && (removeLevel < 1 || removeLevel > 500)) {
      return Err("The remove level must be between 1 and 500.");
    }

    if (!LevelRole.isValidLevelRange(addLevel, removeLevel)) {
      return Err("The remove level must be higher than the add level.");
    }

    const canAddRoleResult = await this.canAddRole(interaction, role);
    if (canAddRoleResult.err) {
      return Err(canAddRoleResult.val);
    }

    const levelRole = LevelRole.create(
      interaction.guildId,
      role.id,
      addLevel,
      removeLevel,
    );

    await this.levelRoleRepository.save(levelRole);
    return Ok(levelRole);
  }

  async deleteLevelRole(
    guildId: string,
    roleId: string,
  ): Promise<Result<void, string>> {
    const deleted = await this.levelRoleRepository.deleteByGuildAndRole(
      guildId,
      roleId,
    );

    if (!deleted) {
      return Err("No level role configuration was found for that role.");
    }

    return Ok.EMPTY;
  }

  async getLevelRolesByGuild(guildId: string): Promise<LevelRole[]> {
    return this.levelRoleRepository.findByGuild(guildId);
  }

  private async canAddRole(
    interaction: ChatInputCommandInteraction<"cached">,
    role: Role,
  ): Promise<Result<void, string>> {
    const sushiiMember = interaction.guild.members.me;

    if (!sushiiMember) {
      return Err("Failed to get sushii member");
    }

    if (sushiiMember.roles.highest.comparePositionTo(role) <= 0) {
      return Err(
        "That role is too high in the hierarchy. Please move the role below my highest role, or move my role higher.",
      );
    }

    return Ok.EMPTY;
  }
}