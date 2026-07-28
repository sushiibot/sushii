import type { ContextMenuCommandInteraction } from "discord.js";
import {
  ApplicationCommandType,
  ApplicationIntegrationType,
  ContextMenuCommandBuilder,
  InteractionContextType,
  PermissionFlagsBits,
} from "discord.js";

import ContextMenuHandler from "@/shared/presentation/handlers/ContextMenuHandler";

import type { ModViewDependencies } from "../ModViewEntry";
import { openModViewOrReportError } from "../ModViewEntry";

/**
 * `setDefaultMemberPermissions(BanMembers)` hides this entry from non-mods'
 * Apps menu entirely — the public account-info glance moved to its own
 * always-visible "User Info" context menu instead of living behind a
 * permission branch here.
 */
export class ModViewContextMenuHandler extends ContextMenuHandler {
  command = new ContextMenuCommandBuilder()
    .setName("Mod View")
    .setType(ApplicationCommandType.User)
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .toJSON();

  constructor(private readonly deps: ModViewDependencies) {
    super();
  }

  async handler(interaction: ContextMenuCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Guild not cached");
    }

    if (!interaction.isUserContextMenuCommand()) {
      throw new Error("Not a user context menu command");
    }

    await openModViewOrReportError(
      interaction,
      interaction.targetUser,
      this.deps,
      "overview",
      true,
    );
  }
}
