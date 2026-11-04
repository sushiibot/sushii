import type { ContextMenuCommandInteraction } from "discord.js";
import {
  ApplicationCommandType,
  ApplicationIntegrationType,
  ContextMenuCommandBuilder,
  InteractionContextType,
  PermissionFlagsBits,
} from "discord.js";

import ContextMenuHandler from "@/shared/presentation/handlers/ContextMenuHandler";

import {
  type AddAsProofDeps,
  renderAddAsProofPicker,
  toSourceMessage,
} from "../components/AddAsProofHandlers";

/** Right-click a message to add it to one of its author's cases, or anyone's. */
export class AddAsProofContextMenuHandler extends ContextMenuHandler {
  command = new ContextMenuCommandBuilder()
    .setName("Add as proof")
    .setType(ApplicationCommandType.Message)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .toJSON();

  constructor(private readonly deps: AddAsProofDeps) {
    super();
  }

  async handler(interaction: ContextMenuCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Guild not cached");
    }
    if (!interaction.isMessageContextMenuCommand()) {
      throw new Error("Not a message context menu command");
    }

    const message = interaction.targetMessage;
    await interaction.reply(
      await renderAddAsProofPicker(
        this.deps,
        interaction.guildId,
        toSourceMessage(message),
        { id: message.author.id, username: message.author.username },
      ),
    );
  }
}
