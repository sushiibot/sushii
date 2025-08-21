import type { ChatInputCommandInteraction } from "discord.js";
import {
  EmbedBuilder,
  InteractionContextType,
  SlashCommandBuilder,
} from "discord.js";

import { newModuleLogger } from "@/shared/infrastructure/logger";
import Paginator from "@/shared/presentation/Paginator";
import { SlashCommandHandler } from "@/shared/presentation/handlers";
import Color from "@/utils/colors";

import type {
  EmojiStatsQueryService,
  QueryStatsRequest,
} from "../../application";

const logger = newModuleLogger("EmojiStatsCommand");

enum CommandOption {
  Type = "type",
  Group = "group",
  Order = "order",
  Server = "server",
  EmojiType = "emoji_type",
}

enum GroupOption {
  Sum = "sum",
  Message = "message",
  Reaction = "reaction",
}

enum OrderOption {
  HighToLow = "high_to_low",
  LowToHigh = "low_to_high",
}

enum ServerOption {
  Sum = "sum",
  Internal = "internal",
  External = "external",
}

enum AssetTypeOption {
  EmojiOnly = "emoji",
  StickerOnly = "sticker",
  Both = "both",
}

enum EmojiTypeOption {
  AnimatedOnly = "animated",
  StaticOnly = "static",
  Both = "both",
}

export class EmojiStatsCommand extends SlashCommandHandler {
  command = new SlashCommandBuilder()
    .setName("emojistats")
    .setDescription("Get stats for server emoji use.")
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) =>
      o
        .setName(CommandOption.Group)
        .setDescription(
          "Sum of both emojis in messages and reactions, or separately? (default: sum)",
        )
        .addChoices(
          {
            name: "Sum: Show sum for both messages and reactions",
            value: GroupOption.Sum,
          },
          {
            name: "Messages only: Show emojis used in messages only",
            value: GroupOption.Message,
          },
          {
            name: "Reactions only: Show emojis used in reactions only",
            value: GroupOption.Reaction,
          },
        ),
    )
    .addStringOption((o) =>
      o
        .setName(CommandOption.Type)
        .setDescription("Emojis or Stickers? (default: Emojis Only)")
        .addChoices(
          {
            name: "Emojis Only: Show emojis only",
            value: AssetTypeOption.EmojiOnly,
          },
          {
            name: "Stickers Only: Show stickers only",
            value: AssetTypeOption.StickerOnly,
          },
          {
            name: "Both: Show both emojis and stickers",
            value: AssetTypeOption.Both,
          },
        ),
    )
    .addStringOption((o) =>
      o
        .setName(CommandOption.EmojiType)
        .setDescription("Animated or static emojis? (default: Both)")
        .addChoices(
          {
            name: "Static Only: Show static only",
            value: EmojiTypeOption.StaticOnly,
          },
          {
            name: "Animated Only: Show animated only",
            value: EmojiTypeOption.AnimatedOnly,
          },
          {
            name: "Both: Show both static and animated",
            value: EmojiTypeOption.Both,
          },
        ),
    )
    .addStringOption((o) =>
      o
        .setName(CommandOption.Order)
        .setDescription("Order for stats? (default: Most used first)")
        .addChoices(
          {
            name: "High to low: Most used first",
            value: OrderOption.HighToLow,
          },
          {
            name: "Low to high: Least used first",
            value: OrderOption.LowToHigh,
          },
        ),
    )
    .addStringOption((o) =>
      o
        .setName(CommandOption.Server)
        .setDescription(
          "Emoji used in this server or others? (default: Only this server)",
        )
        .addChoices(
          {
            name: "Sum: Total count of emojis in ALL servers sushii is in",
            value: ServerOption.Sum,
          },
          {
            name: "This server: Only count emojis used in THIS server",
            value: ServerOption.Internal,
          },
          {
            name: "Other servers: Only count emojis used in OTHER servers",
            value: ServerOption.External,
          },
        ),
    )
    .toJSON();

  constructor(private emojiStatsQueryService: EmojiStatsQueryService) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not in cached guild");
    }

    const guildEmojis = await interaction.guild.emojis.fetch();
    const guildStickers = await interaction.guild.stickers.fetch();

    const order =
      (interaction.options.getString(CommandOption.Order) as OrderOption) ||
      OrderOption.HighToLow;
    const group =
      (interaction.options.getString(CommandOption.Group) as GroupOption) ||
      GroupOption.Sum;
    const server =
      (interaction.options.getString(CommandOption.Server) as ServerOption) ||
      ServerOption.Internal;
    const assetType =
      (interaction.options.getString(CommandOption.Type) as AssetTypeOption) ||
      AssetTypeOption.EmojiOnly;
    const emojiType =
      (interaction.options.getString(
        CommandOption.EmojiType,
      ) as EmojiTypeOption) || EmojiTypeOption.Both;

    logger.debug(
      {
        guildId: interaction.guildId,
        order,
        group,
        server,
        assetType,
        emojiType,
      },
      "Processing emojistats command",
    );

    // Check if guild has requested asset types
    if (assetType === AssetTypeOption.EmojiOnly && guildEmojis.size === 0) {
      const embed = new EmbedBuilder()
        .setTitle("Emoji Stats")
        .setDescription("No emojis found in this server. Add some first!")
        .setColor(Color.Info);

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (assetType === AssetTypeOption.StickerOnly && guildStickers.size === 0) {
      const embed = new EmbedBuilder()
        .setTitle("Sticker Stats")
        .setDescription("No stickers found in this server. Add some first!")
        .setColor(Color.Info);

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (
      assetType === AssetTypeOption.Both &&
      guildEmojis.size === 0 &&
      guildStickers.size === 0
    ) {
      const embed = new EmbedBuilder()
        .setTitle("Emoji and Sticker Stats")
        .setDescription(
          "No emojis or stickers found in this server. Add some first!",
        )
        .setColor(Color.Info);

      await interaction.reply({ embeds: [embed] });
      return;
    }

    try {
      const baseRequest: Omit<QueryStatsRequest, "limit" | "offset"> = {
        guildId: interaction.guildId,
        assetType,
        actionType: group,
        serverUsage: server,
        order,
        emojiType,
      };

      const addEmbedOptions = (eb: EmbedBuilder): EmbedBuilder => {
        eb.setColor(Color.Info);

        // Set footer based on order
        switch (order) {
          case OrderOption.HighToLow:
            eb.setFooter({ text: "Most used first" });
            break;
          case OrderOption.LowToHigh:
            eb.setFooter({ text: "Least used first" });
            break;
        }

        // Set title based on asset type and emoji type
        let assetTypeText = "";
        switch (assetType) {
          case AssetTypeOption.EmojiOnly:
            switch (emojiType) {
              case EmojiTypeOption.AnimatedOnly:
                assetTypeText = "Animated Emoji Stats";
                break;
              case EmojiTypeOption.StaticOnly:
                assetTypeText = "Static Emoji Stats";
                break;
              case EmojiTypeOption.Both:
                assetTypeText = "Emoji Stats";
                break;
            }
            break;
          case AssetTypeOption.StickerOnly:
            assetTypeText = "Sticker Stats";
            break;
          case AssetTypeOption.Both:
            switch (emojiType) {
              case EmojiTypeOption.AnimatedOnly:
                assetTypeText = "Animated Emoji and Sticker Stats";
                break;
              case EmojiTypeOption.StaticOnly:
                assetTypeText = "Static Emoji and Sticker Stats";
                break;
              case EmojiTypeOption.Both:
                assetTypeText = "Emoji and Sticker Stats";
                break;
            }
            break;
        }

        eb.setAuthor({ name: assetTypeText });

        // Set description based on group and server options
        let title = "";
        switch (group) {
          case GroupOption.Sum:
            title = "Total messages + reactions";
            break;
          case GroupOption.Message:
            title = "Messages only";
            break;
          case GroupOption.Reaction:
            title = "Reactions only";
            break;
        }

        switch (server) {
          case ServerOption.Sum:
            title += " | All servers";
            break;
          case ServerOption.Internal:
            title += " | This server";
            break;
          case ServerOption.External:
            title += " | Other servers";
            break;
        }

        eb.setTitle(title);

        return eb;
      };

      const pageSize = 25;
      let cachedTotalCount: number | null = null;

      // Helper function to format stats for display
      const formatStats = (
        stats: Awaited<
          ReturnType<EmojiStatsQueryService["queryStats"]>
        >["results"],
      ) => {
        if (!stats || stats.length === 0) {
          return ["No statistics found."];
        }

        // Apply emojiType filter if specified
        const filteredStats = stats.filter((stat) => {
          if (stat.type === "emoji" && emojiType !== EmojiTypeOption.Both) {
            const emoji = guildEmojis.get(stat.assetId);
            if (emoji) {
              switch (emojiType) {
                case EmojiTypeOption.AnimatedOnly:
                  return emoji.animated;
                case EmojiTypeOption.StaticOnly:
                  return !emoji.animated;
              }
            }
            return false;
          }
          return true;
        });

        if (filteredStats.length === 0) {
          return ["No statistics found for the selected criteria."];
        }

        // Find max count length for padding
        const maxCount = Math.max(...filteredStats.map((s) => s.totalCount));
        const maxCountLength = maxCount.toString().length;

        return filteredStats.map((stat) => {
          const count = stat.totalCount.toString().padStart(maxCountLength);

          if (stat.type === "emoji") {
            const emoji = guildEmojis.get(stat.assetId);
            if (!emoji) {
              return `\`${count}\` ${stat.name} - (ID \`${stat.assetId}\`) not found`;
            }
            return `\`${count}\` - ${emoji} - \`${stat.name}\``;
          } else {
            const sticker = guildStickers.get(stat.assetId);
            if (!sticker) {
              return `\`${count}\` ${stat.name} - (ID \`${stat.assetId}\`) not found`;
            }
            return `\`${count}\` ${sticker.name} - \`${stat.name}\``;
          }
        });
      };

      const paginator = new Paginator({
        interaction,
        pageSize,
        getPageFn: async (pageNum: number, pageSizeParam: number) => {
          const offset = pageNum * pageSizeParam;
          const result = await this.emojiStatsQueryService.queryStats({
            ...baseRequest,
            limit: pageSizeParam,
            offset,
          });

          // Cache total count from first query
          if (cachedTotalCount === null) {
            cachedTotalCount = result.totalCount;
          }

          const formattedStats = formatStats(result.results);
          return formattedStats.join("\n");
        },
        getTotalEntriesFn: async () => {
          // If we haven't cached the total yet, do a minimal query
          if (cachedTotalCount === null) {
            const result = await this.emojiStatsQueryService.queryStats({
              ...baseRequest,
              limit: 1,
              offset: 0,
            });
            cachedTotalCount = result.totalCount;
          }
          return cachedTotalCount;
        },
        embedModifierFn: addEmbedOptions,
      });

      await paginator.paginate();
    } catch (err) {
      logger.error(
        { err, guildId: interaction.guildId },
        "Failed to fetch emoji stats",
      );

      const embed = new EmbedBuilder()
        .setTitle("Error")
        .setDescription(
          "Failed to retrieve emoji statistics. Please try again later.",
        )
        .setColor(Color.Error);

      await interaction.reply({ embeds: [embed] });
    }
  }
}
