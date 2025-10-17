import type { ChatInputCommandInteraction } from "discord.js";
import {
  ChannelType,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { t } from "i18next";

import { SlashCommandHandler } from "@/shared/presentation/handlers";
import Color from "@/utils/colors";

import type { NotificationService } from "../../application/NotificationService";

const ID_REGEX = /\d{17,20}/g;

enum NotificationCommandName {
  Add = "add",
  List = "list",
  Delete = "delete",
  Block = "block",
  BlockChannel = "channel",
  BlockUser = "user",
  Blocklist = "blocklist",
  Unblock = "unblock",
}

export class NotificationCommand extends SlashCommandHandler {
  constructor(private readonly notificationService: NotificationService) {
    super();
  }

  command = new SlashCommandBuilder()
    .setName("notification")
    .setDescription("Get notifications when someone says something.")
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((c) =>
      c
        .setName(NotificationCommandName.Add)
        .setDescription("Set a new notification.")
        .addStringOption((o) =>
          o
            .setName("keyword")
            .setDescription("The keyword to notify you when mentioned.")
            .setRequired(true)
            .setMinLength(2)
            .setMaxLength(100),
        ),
    )
    .addSubcommand((c) =>
      c
        .setName(NotificationCommandName.List)
        .setDescription("List all of your current notifications."),
    )
    .addSubcommand((c) =>
      c
        .setName(NotificationCommandName.Delete)
        .setDescription("Delete a notification.")
        .addStringOption((o) =>
          o
            .setName("keyword")
            .setDescription("The keyword to delete.")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommandGroup((g) =>
      g
        .setName(NotificationCommandName.Block)
        .setDescription("Block notifications from a channel or user.")
        .addSubcommand((c) =>
          c
            .setName(NotificationCommandName.BlockChannel)
            .setDescription("Block a channel from triggering notifications.")
            .addChannelOption((o) =>
              o
                .setName("channel")
                .setDescription(
                  "The channel to block, either a specific one or an entire category.",
                )
                .setRequired(true),
            ),
        )
        .addSubcommand((c) =>
          c
            .setName(NotificationCommandName.BlockUser)
            .setDescription("Block a user from triggering your notifications.")
            .addUserOption((o) =>
              o
                .setName("user")
                .setDescription("The user to block.")
                .setRequired(true),
            ),
        ),
    )
    .addSubcommand((c) =>
      c
        .setName(NotificationCommandName.Blocklist)
        .setDescription("List all blocked channels and users."),
    )
    .addSubcommand((c) =>
      c
        .setName(NotificationCommandName.Unblock)
        .setDescription("Unblock a channel or user from sending notifications.")
        .addStringOption((o) =>
          o
            .setName("block_id")
            .setDescription(
              "Block ID to remove, copied from /notification blocklist",
            )
            .setRequired(true),
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
      case NotificationCommandName.Block:
        switch (subcommand) {
          case NotificationCommandName.BlockChannel:
            return this.handleBlockChannel(interaction);
          case NotificationCommandName.BlockUser:
            return this.handleBlockUser(interaction);
          default:
            throw new Error("Invalid subcommand.");
        }
      default:
      // No group - base commands below
    }

    switch (subcommand) {
      case NotificationCommandName.Add:
        return this.handleAdd(interaction);
      case NotificationCommandName.List:
        return this.handleList(interaction);
      case NotificationCommandName.Delete:
        return this.handleDelete(interaction);
      case NotificationCommandName.Blocklist:
        return this.handleBlocklist(interaction);
      case NotificationCommandName.Unblock:
        return this.handleUnblock(interaction);
      default:
        throw new Error("Invalid subcommand.");
    }
  }

  private async handleAdd(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const keyword = interaction.options.getString("keyword", true);

    try {
      const result = await this.notificationService.addNotification(
        interaction.guildId,
        interaction.user.id,
        keyword,
      );

      if (result.alreadyExists) {
        const embed = new EmbedBuilder()
          .setTitle("Failed to add notification")
          .setDescription(
            `You already have a notification set for \`${keyword}\``,
          )
          .setColor(Color.Error);

        await interaction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle("Added notification.")
        .setFields([{ name: "Keyword", value: keyword }])
        .setColor(Color.Success);

      await interaction.reply({
        embeds: [embed.toJSON()],
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      const embed = new EmbedBuilder()
        .setTitle("Failed to add notification")
        .setDescription(
          error instanceof Error ? error.message : "Unknown error",
        )
        .setColor(Color.Error);

      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private async handleList(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const notifications = await this.notificationService.listNotifications(
      interaction.guildId,
      interaction.user.id,
    );

    const keywords = notifications.map((n) => n.keyword);

    if (keywords.length === 0) {
      await interaction.reply({
        content: t("notification.list.empty", {
          ns: "commands",
        }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(t("notification.list.title", { ns: "commands" }))
      .setDescription(keywords.join("\n"))
      .setColor(Color.Info);

    await interaction.reply({
      embeds: [embed.toJSON()],
      flags: MessageFlags.Ephemeral,
    });
  }

  private async handleDelete(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const keyword = interaction.options.getString("keyword", true);

    const deleted = await this.notificationService.deleteNotification(
      interaction.guildId,
      interaction.user.id,
      keyword,
    );

    if (!deleted) {
      await interaction.reply({
        content: t("notification.delete.not_found", {
          ns: "commands",
          keyword,
        }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(t("notification.delete.title", { ns: "commands" }))
      .setFields([
        {
          name: t("notification.delete.field_title", { ns: "commands" }),
          value: keyword,
        },
      ])
      .setColor(Color.Success);

    await interaction.reply({
      embeds: [embed.toJSON()],
      flags: MessageFlags.Ephemeral,
    });
  }

  private async handleBlockChannel(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const channel = interaction.options.getChannel("channel", true);
    const isCategory = channel.type === ChannelType.GuildCategory;

    const result = await this.notificationService.blockChannel(
      interaction.user.id,
      channel.id,
      isCategory ? "category" : "channel",
    );

    if (result.alreadyExists) {
      const embed = new EmbedBuilder()
        .setTitle("Failed to block channel")
        .setDescription("You already have this channel blocked.")
        .setColor(Color.Error);

      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let description = `You will no longer receive notifications from ${channel.toString()}`;

    if (isCategory) {
      description +=
        "\n\n**Note:** This is a category and all channels in it will be blocked.";
    }

    const embed = new EmbedBuilder()
      .setTitle("Blocked channel")
      .setDescription(description)
      .setColor(Color.Success);

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  }

  private async handleBlockUser(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const user = interaction.options.getUser("user", true);

    const result = await this.notificationService.blockUser(
      interaction.user.id,
      user.id,
    );

    if (result.alreadyExists) {
      const embed = new EmbedBuilder()
        .setTitle("Failed to block user")
        .setDescription("You already have this user blocked.")
        .setColor(Color.Error);

      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("Blocked user")
      .setDescription(
        `You will no longer receive notifications from ${user.toString()}`,
      )
      .setColor(Color.Success);

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  }

  private async handleBlocklist(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const blocks = await this.notificationService.listBlocks(
      interaction.user.id,
    );

    if (blocks.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle("No blocked channels or users")
        .setDescription("You have no channels or users blocked.")
        .setColor(Color.Info);

      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const blocksGrouped = Map.groupBy(blocks, (block) => block.blockType);

    const blockedUsers = blocksGrouped.get("user");
    const blockedChannels = blocksGrouped.get("channel");
    const blockedCategories = blocksGrouped.get("category");

    const formatBlock = (blockId: string, blockType: string): string => {
      if (blockType === "user") {
        return `ID: \`${blockId}\` - <@${blockId}>`;
      }
      return `ID: \`${blockId}\` - <#${blockId}>`;
    };

    const blockedUsersStr = blockedUsers?.map((b) =>
      formatBlock(b.blockId, b.blockType),
    );
    const blockedChannelsStr = blockedChannels?.map((b) =>
      formatBlock(b.blockId, b.blockType),
    );
    let blockedCategoriesStr = blockedCategories?.map((b) =>
      formatBlock(b.blockId, b.blockType),
    );

    if (blockedCategoriesStr) {
      blockedCategoriesStr.push(
        "\n**Note:** All channels within these categories are blocked.",
      );
    } else {
      blockedCategoriesStr = [
        "**Note:** All channels in categories are blocked.",
      ];
    }

    const fields = [
      {
        name: "Blocked users",
        value: blockedUsersStr?.join("\n") || "No users are blocked",
      },
      {
        name: "Blocked channels",
        value: blockedChannelsStr?.join("\n") || "No channels are blocked",
      },
      {
        name: "Blocked categories",
        value: blockedCategoriesStr?.join("\n") || "No categories are blocked",
      },
    ];

    const embed = new EmbedBuilder()
      .setTitle("Notification Block List")
      .setFields(fields)
      .setColor(Color.Info);

    await interaction.reply({
      embeds: [embed.toJSON()],
      flags: MessageFlags.Ephemeral,
    });
  }

  private async handleUnblock(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const blockStr = interaction.options.getString("block_id", true);
    const match = blockStr.match(ID_REGEX);

    if (!match) {
      const embed = new EmbedBuilder()
        .setTitle("Failed to unblock")
        .setDescription(
          "Invalid block. Please paste the block ID from /notification blocklist, or mention a user or channel.",
        )
        .setColor(Color.Error);

      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const matchId = match[0];
    const deletedBlock = await this.notificationService.unblock(
      interaction.user.id,
      matchId,
    );

    if (!deletedBlock) {
      const embed = new EmbedBuilder()
        .setTitle("Failed to unblock")
        .setDescription(
          "You don't have this channel or user blocked. Please paste the block ID from /notification blocklist.",
        )
        .setColor(Color.Error);

      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const blockMention = deletedBlock.isUserBlock
      ? `<@${deletedBlock.blockId}>`
      : `<#${deletedBlock.blockId}>`;

    const embed = new EmbedBuilder()
      .setTitle("Unblocked")
      .setDescription(`You will now receive notifications from ${blockMention}`)
      .setColor(Color.Success);

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  }
}
