import {
  ChatInputCommandInteraction,
  InteractionContextType,
  SlashCommandBuilder,
} from "discord.js";
import { PermissionFlagsBits } from "discord.js";

import { SlashCommandHandler } from "@/interactions/handlers";
import { interactionReplyErrorPlainMessage } from "@/interactions/responses/error";

import { LevelRoleService } from "../../application/LevelRoleService";
import {
  formatCreateSuccess,
  formatDeleteSuccess,
  formatList,
} from "../views/LevelRoleView";

enum CommandName {
  LevelRoleNew = "new",
  LevelRoleDelete = "delete",
  LevelRoleList = "list",
}

enum LevelRoleOption {
  Role = "role",
  AddLevel = "add_level",
  RemoveLevel = "remove_level",
  Channel = "channel",
}

export default class LevelRoleCommand extends SlashCommandHandler {
  constructor(private readonly levelRoleService: LevelRoleService) {
    super();
  }
  command = new SlashCommandBuilder()
    .setName("levelrole")
    .setDescription("Configure level roles.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((c) =>
      c
        .setName(CommandName.LevelRoleNew)
        .setDescription("Create a new level role.")
        .addRoleOption((o) =>
          o
            .setName(LevelRoleOption.Role)
            .setDescription("The role to add.")
            .setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName(LevelRoleOption.AddLevel)
            .setDescription("The level to add the role at.")
            .setRequired(true)
            .setMinValue(2)
            .setMaxValue(500),
        )
        .addIntegerOption((o) =>
          o
            .setName(LevelRoleOption.RemoveLevel)
            .setDescription(
              "The level to remove the role at. This must be higher than add_level",
            )
            .setRequired(false)
            .setMinValue(3)
            .setMaxValue(500),
        ),
    )
    .addSubcommand((c) =>
      c
        .setName(CommandName.LevelRoleDelete)
        .setDescription("Delete a level role.")
        .addRoleOption((o) =>
          o
            .setName(LevelRoleOption.Role)
            .setDescription("The role to remove.")
            .setRequired(true),
        ),
    )
    .addSubcommand((c) =>
      c.setName(CommandName.LevelRoleList).setDescription("List level roles."),
    )
    .toJSON();

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Guild not cached");
    }

    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case CommandName.LevelRoleNew:
        return this.newLevelRoleHandler(interaction);
      case CommandName.LevelRoleDelete:
        return this.deleteLevelRoleHandler(interaction);
      case CommandName.LevelRoleList:
        return this.listLevelRoleHandler(interaction);
      default:
        throw new Error(`Invalid command ${subcommand}`);
    }
  }

  private async newLevelRoleHandler(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const role = interaction.options.getRole(LevelRoleOption.Role, true);
    const addLevel = interaction.options.getInteger(
      LevelRoleOption.AddLevel,
      true,
    );
    const removeLevel = interaction.options.getInteger(
      LevelRoleOption.RemoveLevel,
    );

    const result = await this.levelRoleService.createLevelRole(
      interaction,
      role,
      addLevel,
      removeLevel ?? undefined,
    );

    if (result.err) {
      await interactionReplyErrorPlainMessage(interaction, result.val, true);
      return;
    }

    await interaction.reply(formatCreateSuccess(result.val));
  }

  private async deleteLevelRoleHandler(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const role = interaction.options.getRole(LevelRoleOption.Role, true);

    const result = await this.levelRoleService.deleteLevelRole(
      interaction.guildId,
      role.id,
    );

    if (result.err) {
      await interactionReplyErrorPlainMessage(interaction, result.val, true);
      return;
    }

    await interaction.reply(formatDeleteSuccess(role.id));
  }

  private async listLevelRoleHandler(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const levelRoles = await this.levelRoleService.getLevelRolesByGuild(
      interaction.guildId,
    );

    await interaction.reply(formatList(levelRoles));
  }
}
