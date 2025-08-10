import type {
  ChatInputCommandInteraction,
  GuildMember,
  User,
} from "discord.js";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

export default async function hasPermissionTargetingMember(
  interaction: ChatInputCommandInteraction,
  targetUser?: User,
  targetMember?: GuildMember,
): Promise<Result<true, string>> {
  if (!interaction.inCachedGuild()) {
    // Not really but whatever lol
    return Ok(true);
  }

  if (!targetMember || !targetUser) {
    return Ok(true);
  }

  const { member: executorMember } = interaction;

  // Cannot target self -- even if owner just to prevent failure
  if (targetUser.id === executorMember.user.id) {
    return Err("You cannot target yourself");
  }

  // Executor owner, always ok
  if (executorMember.user.id === interaction.guild.ownerId) {
    return Ok(true);
  }

  // Cannot target owner
  if (targetUser.id === interaction.guild.ownerId) {
    return Err("You cannot target the owner");
  }

  // Default 0 for @everyone role position
  const highestMemberRolePosition = executorMember.roles.highest.position;
  const highestTargetRolePosition = targetMember.roles.highest.position;

  // Target highest role has to be less than current role.
  if (highestTargetRolePosition < highestMemberRolePosition) {
    return Ok(true);
  }

  if (highestTargetRolePosition === highestMemberRolePosition) {
    return Err(
      "You cannot target a member with the same highest role than you",
    );
  }

  return Err("You cannot target a member with a higher role than you");
}
