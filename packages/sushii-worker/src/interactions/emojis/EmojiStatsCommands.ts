import type {
  ChatInputCommandInteraction,
  GuildEmoji,
  Sticker,
  Collection} from "discord.js";
import {
  SlashCommandBuilder,
  EmbedBuilder,
  InteractionContextType,
} from "discord.js";

import { SlashCommandHandler } from "../handlers";
import db from "../../infrastructure/database/db";
import Color from "../../utils/colors";
import logger from "@/shared/infrastructure/logger";
import type { AppPublicGuildAssetType } from "../../infrastructure/database/dbTypes";
import Paginator from "@/shared/presentation/Paginator";

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

interface EmojiStat {
  asset_id: string;
  total_count?: string | number | bigint;
  name: string;
  type: AppPublicGuildAssetType;
}

interface RequestOptions {
  group: GroupOption;
  order: OrderOption;
  server: ServerOption;
  assetType: AssetTypeOption;
  emojiType: EmojiTypeOption;
}

async function getAllStats(
  interaction: ChatInputCommandInteraction,
  guildEmojis: Collection<string, GuildEmoji>,
  guildStickers: Collection<string, Sticker>,
  { group, order, server, assetType, emojiType }: RequestOptions,
): Promise<string[]> {
  let query = db
    .selectFrom("app_public.emoji_sticker_stats")
    // Right join, since we want to exclude the items that are missing from the emoji/sticker table
    .innerJoin(
      "app_public.guild_emojis_and_stickers",
      "app_public.emoji_sticker_stats.asset_id",
      "app_public.guild_emojis_and_stickers.id",
    )
    .select(["asset_id", "type", "name"])
    // ---------------------
    // Specific servers -- if not specified, only internal
    // Includes where clause for the count in order to exclude 0 counts
    // This uses $if since we need it for the total_count alias to work later
    .$if(server === ServerOption.Internal, (q) =>
      q
        .select((eb) => eb.fn.sum("count").as("total_count"))
        .where("count", ">", "0"),
    )
    .$if(server === ServerOption.External, (q) =>
      q
        .select((eb) => eb.fn.sum("count_external").as("total_count"))
        .where("count_external", ">", "0"),
    )
    .$if(server === ServerOption.Sum, (q) =>
      q.select((eb) =>
        eb.fn.sum(eb("count", "+", eb.ref("count_external"))).as("total_count"),
      ),
    )
    // Limit by emojis from this guild, specifying the emoji/sticker table, not metrics.
    // This may include deleted expressions.
    .where(
      "app_public.guild_emojis_and_stickers.guild_id",
      "=",
      interaction.guildId,
    )
    .groupBy(["asset_id", "type", "name"]);

  switch (assetType) {
    case AssetTypeOption.EmojiOnly: {
      query = query.where(
        "app_public.guild_emojis_and_stickers.type",
        "=",
        "emoji",
      );
      break;
    }
    case AssetTypeOption.StickerOnly: {
      query = query.where(
        "app_public.guild_emojis_and_stickers.type",
        "=",
        "sticker",
      );
      break;
    }
    case AssetTypeOption.Both: {
      // do nothing
      break;
    }
  }

  // ---------------------
  // Specific types -- if not specified, adds both together
  switch (group) {
    case GroupOption.Message: {
      query = query.where("action_type", "=", "message");
      break;
    }
    case GroupOption.Reaction: {
      query = query.where("action_type", "=", "reaction");
      break;
    }
    case GroupOption.Sum: {
      break;
    }
  }

  // ---------------------
  // Order by total_count
  switch (order) {
    case OrderOption.HighToLow: {
      query = query.orderBy("total_count", "desc");
      break;
    }
    case OrderOption.LowToHigh: {
      query = query.orderBy("total_count", "asc");
      break;
    }
  }

  let values = await query
    // Secondary sort so it's consistent
    .orderBy("asset_id")
    // Exclude 0 counts, e.g. used internal but not external
    .execute();

  logger.debug(
    {
      valueLength: values.length,
    },
    "getStatsPage",
  );

  const valueIDSet = new Set(values.map((v) => v.asset_id));

  // Add emojis that have no stats (not used yet, but useful if querying by least to most used)
  if (
    assetType === AssetTypeOption.Both ||
    assetType === AssetTypeOption.EmojiOnly
  ) {
    const zeroUseEmojis = guildEmojis
      .filter((e) => !valueIDSet.has(e.id))
      .map(
        (e): EmojiStat => ({
          asset_id: e.id,
          name: e.name || "Unknown",
          total_count: "0",
          type: "emoji",
        }),
      );

    if (order === OrderOption.HighToLow) {
      // Add to end
      values.push(...zeroUseEmojis);
    } else {
      // Add to beginning
      values.unshift(...zeroUseEmojis);
    }
  }

  if (
    assetType === AssetTypeOption.Both ||
    assetType === AssetTypeOption.StickerOnly
  ) {
    const zeroUseStickers = guildStickers
      .filter((e) => !valueIDSet.has(e.id))
      .map(
        (e): EmojiStat => ({
          asset_id: e.id,
          name: e.name,
          total_count: "0",
          type: "sticker",
        }),
      );

    if (order === OrderOption.HighToLow) {
      // Add to end
      values.push(...zeroUseStickers);
    } else {
      // Add to beginning
      values.unshift(...zeroUseStickers);
    }
  }

  if (
    assetType === AssetTypeOption.EmojiOnly ||
    assetType === AssetTypeOption.Both
  ) {
    values = values.filter((v) => {
      if (v.type !== "emoji") {
        return true;
      }

      const emoji = guildEmojis.get(v.asset_id);
      if (!emoji) {
        return true;
      }

      // Filter by desired emoji type
      switch (emojiType) {
        case EmojiTypeOption.AnimatedOnly: {
          return emoji.animated;
        }
        case EmojiTypeOption.StaticOnly: {
          return !emoji.animated;
        }
        case EmojiTypeOption.Both: {
          return true;
        }
        default: {
          throw new Error(`Invalid emoji type ${emojiType}`);
        }
      }
    });
  }

  let maxCount: string | undefined;
  if (order === OrderOption.HighToLow) {
    maxCount = values.at(0)?.total_count?.toString();
  } else {
    maxCount = values.at(values.length - 1)?.total_count?.toString();
  }

  const maxCountLength = maxCount?.length || 0;

  const formatStat = (v: EmojiStat): string => {
    const totalCount = v.total_count?.toString() || "0";
    const totalCountPadded = totalCount.padStart(maxCountLength);

    if (v.type === "emoji") {
      const emoji = guildEmojis.get(v.asset_id);
      if (!emoji) {
        let s = "";
        s += `\`${totalCountPadded}\``;
        s += " ";
        s += v.name;
        s += " - ";
        s += `(ID \`${v.asset_id}\`) not found`;

        return s;
      }

      let s = "";
      s += `\`${totalCountPadded}\``;
      s += " - ";
      s += `${emoji}`;
      s += " - ";
      s += `\`${v.name}\``;

      return s;
    }

    const sticker = guildStickers.get(v.asset_id);
    if (!sticker) {
      let s = "";
      s += `\`${totalCountPadded}\``;
      s += " ";
      s += v.name;
      s += " - ";
      s += `(ID \`${v.asset_id}\`) not found`;

      return s;
    }

    let s = "";
    s += `\`${totalCountPadded}\``;
    s += " ";
    s += `${sticker.name}`;
    s += " - ";
    s += `\`${sticker.name}\``;

    return s;
  };

  return values.map(formatStat);
}

export default class EmojiStatsCommand extends SlashCommandHandler {
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

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not in cached guild");
    }

    const guildEmojis = await interaction.guild.emojis.fetch();
    const guildStickers = await interaction.guild.stickers.fetch();

    const order = (interaction.options.getString(CommandOption.Order) ||
      OrderOption.HighToLow) as OrderOption;

    const group = (interaction.options.getString(CommandOption.Group) ||
      GroupOption.Sum) as GroupOption;

    const server = (interaction.options.getString(CommandOption.Server) ||
      ServerOption.Internal) as ServerOption;

    const assetType = (interaction.options.getString(CommandOption.Type) ||
      AssetTypeOption.EmojiOnly) as AssetTypeOption;

    const emojiType = (interaction.options.getString(CommandOption.EmojiType) ||
      EmojiTypeOption.Both) as EmojiTypeOption;

    logger.debug(
      {
        order,
        group,
        server,
        assetType,
      },
      "emojistats options",
    );

    if (assetType === AssetTypeOption.EmojiOnly && guildEmojis.size === 0) {
      const embed = new EmbedBuilder()
        .setTitle("Emoji Stats")
        .setDescription("No emojis found in this server. Add some first!")
        .setColor(Color.Info);

      await interaction.reply({
        embeds: [embed],
      });

      return;
    }

    if (assetType === AssetTypeOption.StickerOnly && guildStickers.size === 0) {
      const embed = new EmbedBuilder()
        .setTitle("Sticker Stats")
        .setDescription("No stickers found in this server. Add some first!")
        .setColor(Color.Info);

      await interaction.reply({
        embeds: [embed],
      });

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

      await interaction.reply({
        embeds: [embed],
      });

      return;
    }

    const allStats = await getAllStats(
      interaction,
      guildEmojis,
      guildStickers,
      {
        group,
        order,
        server,
        assetType,
        emojiType,
      },
    );

    const addEmbedOptions = (eb: EmbedBuilder): EmbedBuilder => {
      eb.setColor(Color.Info);

      switch (order) {
        case OrderOption.HighToLow:
          eb.setFooter({
            text: "Most used first",
          });

          break;
        case OrderOption.LowToHigh:
          eb.setFooter({
            text: "Least used first",
          });
          break;
        default:
          break;
      }

      let assetTypeText;
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
          }

          break;
      }

      eb.setAuthor({
        name: assetTypeText,
      });

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
        default:
          throw new Error(`Invalid grouping option ${group}`);
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
        default:
          throw new Error(`Invalid server option ${server}`);
      }

      eb.setTitle(title);

      return eb;
    };

    const paginator = new Paginator({
      interaction,
      getPageFn: async (pageNum, pageSize) =>
        allStats.slice(pageNum * pageSize, (pageNum + 1) * pageSize).join("\n"),
      getTotalEntriesFn: async () => allStats.length,
      pageSize: 25,
      embedModifierFn: addEmbedOptions,
    });

    await paginator.paginate();
  }
}
