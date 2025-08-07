import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  InteractionContextType,
  SlashCommandBuilder,
} from "discord.js";
import { PermissionFlagsBits } from "discord.js";

import {
  deleteXpBlock,
  getXpBlocks,
  upsertXpBlock,
} from "@//db/XpBlock/XpBlock.repository";
import db from "@//infrastructure/database/db";
import { SlashCommandHandler } from "@/interactions/handlers";
import { interactionReplyErrorPlainMessage } from "@/interactions/responses/error";
import Color from "@/utils/colors";

enum XpGroupName {
  Block = "block",
  Unblock = "unblock",
}

enum XpCommandName {
  Channel = "channel",
  Role = "role",
  BlockList = "list",
}

enum XpOption {
  Role = "role",
  AddLevel = "add_level",
  RemoveLevel = "remove_level",
  Channel = "channel",
}

export default class XpCommand extends SlashCommandHandler {
  command = new SlashCommandBuilder()
    .setName("xp")
    .setDescription("Configure xp options and level roles.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommandGroup((g) =>
      g
        .setName(XpGroupName.Block)
        .setDescription("Block channel or roles from gaining xp.")
        .addSubcommand((c) =>
          c
            .setName(XpCommandName.Channel)
            .setDescription("Block a channel from gaining xp.")
            .addChannelOption((o) =>
              o
                .setName(XpOption.Channel)
                .setDescription("The channel to block.")
                .setRequired(true),
            ),
        )
        .addSubcommand((c) =>
          c
            .setName(XpCommandName.Role)
            .setDescription("Block a role from gaining xp.")
            .addRoleOption((o) =>
              o
                .setName(XpOption.Role)
                .setDescription("The role to block.")
                .setRequired(true),
            ),
        )
        .addSubcommand((c) =>
          c
            .setName(XpCommandName.BlockList)
            .setDescription("List all blocked channels or roles."),
        ),
    )
    .addSubcommandGroup((g) =>
      g
        .setName(XpGroupName.Unblock)
        .setDescription("Unblock channel or roles from gaining xp.")
        .addSubcommand((c) =>
          c
            .setName(XpCommandName.Channel)
            .setDescription("Unblock a channel from gaining xp.")
            .addChannelOption((o) =>
              o
                .setName(XpOption.Channel)
                .setDescription("The channel unblock.")
                .setRequired(true),
            ),
        )
        .addSubcommand((c) =>
          c
            .setName(XpCommandName.Role)
            .setDescription("Unblock a role from gaining xp.")
            .addRoleOption((o) =>
              o
                .setName(XpOption.Role)
                .setDescription("The role to unblock.")
                .setRequired(true),
            ),
        ),
    )
    .toJSON();

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Guild not cached");
    }

    const subgroup = interaction.options.getSubcommandGroup();
    const subcommand = interaction.options.getSubcommand();

    switch (subgroup) {
      case XpGroupName.Block:
        switch (subcommand) {
          case XpCommandName.Channel:
            return this.blockChannelHandler(interaction);
          case XpCommandName.Role:
            return this.blockRoleHandler(interaction);
          case XpCommandName.BlockList:
            return this.listBlocksHandler(interaction);
          default:
            throw new Error(
              `Invalid subcommand for group ${subgroup}: ${subcommand}`,
            );
        }
      case XpGroupName.Unblock:
        switch (subcommand) {
          case XpCommandName.Channel:
            return this.unblockChannelHandler(interaction);
          case XpCommandName.Role:
            return this.unblockRoleHandler(interaction);
          default:
            throw new Error(
              `Invalid subcommand for group ${subgroup}: ${subcommand}`,
            );
        }
      default:
        throw new Error("Invalid subgroup");
    }
  }

  private async blockChannelHandler(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const channel = interaction.options.getChannel(XpOption.Channel);
    if (!channel) {
      throw new Error("Missing channel");
    }

    const newBlock = await upsertXpBlock(
      db,
      interaction.guildId,
      channel.id,
      "channel",
    );

    if (!newBlock) {
      await interactionReplyErrorPlainMessage(
        interaction,
        `Channel <#${channel.id}> is already blocked`,
        true,
      );

      return;
    }

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Added XP block for channel")
          .setFields([
            {
              name: "Channel",
              value: `<#${channel.id}>`,
            },
          ])
          .setColor(Color.Success)
          .toJSON(),
      ],
    });
  }

  private async blockRoleHandler(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const role = interaction.options.getRole(XpOption.Role);
    if (!role) {
      throw new Error("Missing role");
    }

    const newBlock = await upsertXpBlock(
      db,
      interaction.guildId,
      role.id,
      "role",
    );

    if (!newBlock) {
      await interactionReplyErrorPlainMessage(
        interaction,
        `Role <@&${role.id}> is already blocked`,
        true,
      );

      return;
    }

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Added XP block for role")
          .setFields([
            {
              name: "Role",
              value: `<@&${role.id}>`,
            },
          ])
          .setColor(Color.Success)
          .toJSON(),
      ],
    });
  }

  private async listBlocksHandler(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const allBlocks = await getXpBlocks(db, interaction.guildId);

    if (allBlocks.length === 0) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("All XP blocks")
            .setDescription("There are no XP blocks")
            .setColor(Color.Success)
            .toJSON(),
        ],
      });

      return;
    }

    const channelBlocks = allBlocks
      .filter((block) => block.block_type === "channel")
      .map((block) => `<#${block.block_id}>`);

    const roleBlocks = allBlocks
      .filter((block) => block.block_type === "role")
      .map((block) => `<@&${block.block_id}>`);

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("All XP blocks")
          .setFields([
            {
              name: "Channels",
              value: channelBlocks.join("\n") || "No channels are blocked",
              inline: false,
            },
            {
              name: "Roles",
              value: roleBlocks.join("\n") || "No roles are blocked",
              inline: false,
            },
          ])
          .setColor(Color.Success)
          .toJSON(),
      ],
    });
  }

  private async unblockChannelHandler(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const channel = interaction.options.getChannel(XpOption.Channel);
    if (!channel) {
      throw new Error("Missing channel");
    }

    const res = await deleteXpBlock(db, interaction.guildId, channel.id);

    if (!res) {
      await interactionReplyErrorPlainMessage(
        interaction,
        `No XP block was found for <#${channel.id}>`,
        true,
      );

      return;
    }

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Unblocked XP for channel")
          .setFields([
            {
              name: "Channel",
              value: `<#${channel.id}>`,
            },
          ])
          .setColor(Color.Success)
          .toJSON(),
      ],
    });
  }

  private async unblockRoleHandler(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const role = interaction.options.getRole(XpOption.Role);
    if (!role) {
      throw new Error("Missing role");
    }

    const res = await deleteXpBlock(db, interaction.guildId, role.id);

    if (!res) {
      await interactionReplyErrorPlainMessage(
        interaction,
        `No XP block was found for <@&${role.id}>`,
        true,
      );

      return;
    }

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Unblocked XP for role")
          .setFields([
            {
              name: "Role",
              value: `<@&${role.id}>`,
            },
          ])
          .setColor(Color.Success)
          .toJSON(),
      ],
    });
  }
}
