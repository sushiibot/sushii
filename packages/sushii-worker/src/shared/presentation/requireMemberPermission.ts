import type { ButtonInteraction, PermissionResolvable } from "discord.js";
import {
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  TextDisplayBuilder,
} from "discord.js";

import Color from "@/utils/colors";

export const ANY_MOD_PERMISSION = {
  flags: [
    PermissionFlagsBits.BanMembers,
    PermissionFlagsBits.KickMembers,
    PermissionFlagsBits.ModerateMembers,
  ],
  name: "Ban Members, Kick Members, or Timeout Members",
};

/**
 * Checks the clicker's permissions on a guild button. Buttons on mod-only
 * messages are usable by anyone who can see the channel, so channel placement
 * alone can't gate bot-authority actions.
 *
 * Passes if the member has any of the given permissions. Replies with an
 * ephemeral error and returns false otherwise.
 */
export async function requireMemberPermission(
  interaction: ButtonInteraction<"cached">,
  permission: PermissionResolvable,
  permissionName: string,
): Promise<boolean> {
  if (interaction.memberPermissions.any(permission)) {
    return true;
  }

  const container = new ContainerBuilder()
    .setAccentColor(Color.Error)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `You need **${permissionName}** to do that.`,
      ),
    );

  await interaction.reply({
    components: [container],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  });

  return false;
}
