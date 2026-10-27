import type {
  ChatInputCommandInteraction,
  GuildTextBasedChannel,
} from "discord.js";
import {
  ApplicationIntegrationType,
  DiscordAPIError,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  SlashCommandBuilder,
  messageLink,
} from "discord.js";
import type { Logger } from "pino";

import {
  getErrorMessage,
  getErrorMessageEdit,
} from "@/interactions/responses/error";
import dayjs from "@/shared/domain/dayjs";
import { SlashCommandHandler } from "@/shared/presentation/handlers";
import Color from "@/utils/colors";
import parseDuration from "@/utils/parseDuration";
import toTimestamp from "@/utils/toTimestamp";

import type { GiveawayDrawService } from "../../application/GiveawayDrawService";
import type { GiveawayEndService } from "../../application/GiveawayEndService";
import type { GiveawayService } from "../../application/GiveawayService";
import type { GiveawayData } from "../../domain/entities/Giveaway";
import { Giveaway } from "../../domain/entities/Giveaway";
import { buildGiveawayComponents } from "../views/GiveawayComponentBuilder";
import { buildGiveawayEmbed } from "../views/GiveawayEmbedBuilder";

enum GiveawayOption {
  GiveawayID = "giveaway_id",
  Duration = "duration",
  Winners = "winners",
  Prize = "prize",
  RequiredRole = "required_role",
  RequiredMinLevel = "min_level",
  RequiredMaxLevel = "max_level",
  BoosterStatus = "booster_status",
  AllowRepeatWinners = "allow_repeat_winners",
}

/**
 * Channel fetch errors meaning the giveaway channel is gone or hidden from us
 */
const MISSING_CHANNEL_ERROR_CODES = new Set<number | string>([
  RESTJSONErrorCodes.UnknownChannel,
  RESTJSONErrorCodes.MissingAccess,
]);

enum GiveawaySubcommand {
  Create = "create",
  List = "list",
  Delete = "delete",
  End = "end",
  Reroll = "reroll",
}

export class GiveawayCommand extends SlashCommandHandler {
  command = new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Host giveaways in your server.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((c) =>
      c
        .setName(GiveawaySubcommand.Create)
        .setDescription("Create a new giveaway.")
        .addStringOption((o) =>
          o
            .setName(GiveawayOption.Duration)
            .setDescription("How long before winners are picked?")
            .setRequired(true),
        )
        .addNumberOption((o) =>
          o
            .setName(GiveawayOption.Winners)
            .setDescription("How people can win?")
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName(GiveawayOption.Prize)
            .setDescription("What do winners win?")
            .setRequired(true),
        )
        .addRoleOption((o) =>
          o
            .setName(GiveawayOption.RequiredRole)
            .setDescription("Role required to enter.")
            .setRequired(false),
        )
        .addNumberOption((o) =>
          o
            .setName(GiveawayOption.RequiredMinLevel)
            .setDescription("Minimum level required to enter.")
            .setMinValue(1)
            .setRequired(false),
        )
        .addNumberOption((o) =>
          o
            .setName(GiveawayOption.RequiredMaxLevel)
            .setDescription("Maximum level required to enter.")
            .setMinValue(2)
            .setRequired(false),
        )
        .addBooleanOption((o) =>
          o
            .setName(GiveawayOption.BoosterStatus)
            .setDescription(
              "Require server boosting to enter or the other way around.",
            )
            .setRequired(false),
        ),
    )
    .addSubcommand((c) =>
      c
        .setName(GiveawaySubcommand.Delete)
        .setDescription("Delete an active giveaway.")
        .addStringOption((o) =>
          o
            .setName(GiveawayOption.GiveawayID)
            .setDescription("ID of the giveaway to delete.")
            .setAutocomplete(true)
            .setRequired(true),
        ),
    )
    .addSubcommand((c) =>
      c
        .setName(GiveawaySubcommand.List)
        .setDescription("List all active giveaways in this server."),
    )
    .addSubcommand((c) =>
      c
        .setName(GiveawaySubcommand.End)
        .setDescription("Immediately end and pick the winners for a giveaway.")
        .addStringOption((o) =>
          o
            .setName(GiveawayOption.GiveawayID)
            .setDescription("ID of the giveaway to end.")
            .setAutocomplete(true)
            .setRequired(true),
        ),
    )
    .addSubcommand((c) =>
      c
        .setName(GiveawaySubcommand.Reroll)
        .setDescription("Pick one new winner for an ended giveaway.")
        .addStringOption((o) =>
          o
            .setName(GiveawayOption.GiveawayID)
            .setDescription("ID of the giveaway to reroll.")
            .setAutocomplete(true)
            .setRequired(true),
        )
        .addNumberOption((o) =>
          o
            .setName(GiveawayOption.Winners)
            .setDescription("How many new winners to pick? (default: 1)")
            .setRequired(false),
        )
        .addBooleanOption((o) =>
          o
            .setName(GiveawayOption.AllowRepeatWinners)
            .setDescription(
              "Allow previous winners to win again? (Default: no)",
            )
            .setRequired(false),
        ),
    )
    .toJSON();

  constructor(
    private readonly giveawayService: GiveawayService,
    private readonly giveawayDrawService: GiveawayDrawService,
    private readonly giveawayEndService: GiveawayEndService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not in cached guild");
    }

    const subcommand = interaction.options.getSubcommand(true);
    switch (subcommand) {
      case GiveawaySubcommand.Create:
        await this.createGiveaway(interaction);
        break;
      case GiveawaySubcommand.List:
        await this.listGiveaways(interaction);
        break;
      case GiveawaySubcommand.Delete:
        await this.deleteGiveaway(interaction);
        break;
      case GiveawaySubcommand.End:
        await this.endGiveaway(interaction);
        break;
      case GiveawaySubcommand.Reroll:
        await this.rerollGiveaway(interaction);
        break;
      default:
        throw new Error("Invalid subcommand");
    }
  }

  private async createGiveaway(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const durationStr = interaction.options.getString(
      GiveawayOption.Duration,
      true,
    );
    const duration = parseDuration(durationStr);
    if (!duration) {
      await interaction.reply(
        getErrorMessage(
          "Invalid duration",
          "Please provide a valid duration. Examples: `1w` for 1 week, `1d` for 1 day, `1h` for 1 hour, `1d2h` for 1 day and 2 hours",
        ),
      );
      return;
    }

    const winners = interaction.options.getNumber(GiveawayOption.Winners, true);
    const prize = interaction.options.getString(GiveawayOption.Prize, true);
    const requiredRole = interaction.options.getRole(
      GiveawayOption.RequiredRole,
    );
    const requiredMinLevel = interaction.options.getNumber(
      GiveawayOption.RequiredMinLevel,
    );
    const requiredMaxLevel = interaction.options.getNumber(
      GiveawayOption.RequiredMaxLevel,
    );
    const boosterStatus = interaction.options.getBoolean(
      GiveawayOption.BoosterStatus,
    );

    if (!interaction.channel) {
      throw new Error("No channel");
    }

    const giveawayData: GiveawayData = {
      id: "DUMMY ID", // Will be replaced with message ID
      channelId: interaction.channelId,
      guildId: interaction.guildId,
      hostUserId: interaction.user.id,
      numWinners: winners,
      prize,
      requiredRoleId: requiredRole?.id,
      requiredMinLevel: requiredMinLevel ?? undefined,
      requiredMaxLevel: requiredMaxLevel ?? undefined,
      requiredBoosting: boosterStatus ?? undefined,
      startAt: dayjs.utc().toDate(),
      endAt: dayjs.utc().add(duration).toDate(),
      isEnded: false,
    };

    const tempGiveaway = new Giveaway(giveawayData);
    const embed = buildGiveawayEmbed(tempGiveaway, []);
    const components = buildGiveawayComponents(0, false);

    let giveawayMsg;
    try {
      giveawayMsg = await interaction.channel.send({
        embeds: [embed],
        components,
      });
    } catch (err) {
      if (err instanceof DiscordAPIError) {
        if (err.code === RESTJSONErrorCodes.MissingPermissions) {
          await interaction.reply(
            getErrorMessage(
              "Missing permissions",
              `I don't have permission to send messages in <#${interaction.channelId}>.\n\nPlease grant me the **Send Messages** and **Embed Links** permissions in this channel, then try again.`,
              true,
            ),
          );
          return;
        }

        if (err.code === RESTJSONErrorCodes.MissingAccess) {
          await interaction.reply(
            getErrorMessage(
              "Missing access",
              `I can't access <#${interaction.channelId}>.\n\nPlease make sure I have the **View Channel** and **Send Messages** permissions here, then try again.`,
              true,
            ),
          );
          return;
        }
      }
      throw err;
    }

    // Update the giveaway data with the actual message ID
    giveawayData.id = giveawayMsg.id;

    try {
      await this.giveawayService.createGiveaway(giveawayData);
    } catch (err) {
      // Don't leave a giveaway message behind that can't be entered
      try {
        await giveawayMsg.delete();
      } catch (deleteErr) {
        this.logger.warn(
          { err: deleteErr, giveawayId: giveawayMsg.id },
          "Failed to delete giveaway message after create failed",
        );
      }

      throw err;
    }

    const responseEmbed = new EmbedBuilder()
      .setTitle("Giveaway created!")
      .setDescription(`You can find your giveaway [here](${giveawayMsg?.url}).`)
      .setColor(Color.Success);

    await interaction.reply({
      embeds: [responseEmbed],
      flags: MessageFlags.Ephemeral,
    });
  }

  private async listGiveaways(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const giveaways = await this.giveawayService.getActiveGiveaways(
      interaction.guildId,
    );

    if (giveaways.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle("No active giveaways")
        .setDescription("Create a new one with /giveaway create")
        .setColor(Color.Info);

      await interaction.reply({
        embeds: [embed],
      });
      return;
    }

    let desc = "";

    for (const giveaway of giveaways) {
      const endAt = dayjs.utc(giveaway.endAt);
      const fullTs = toTimestamp(endAt, "f");
      const relTs = toTimestamp(endAt, "R");

      const giveawayUrl = messageLink(
        giveaway.channelId,
        giveaway.id,
        interaction.guildId,
      );

      desc += `**ID:** [\`${giveaway.id}\`](${giveawayUrl})\n`;
      desc += `╰ Ending: ${relTs} ~ ${fullTs}\n`;
      desc += `╰ Prize: ${giveaway.prize}\n`;
      desc += `╰ Winners: ${giveaway.numWinners}\n`;
      desc += `╰ Host: <@${giveaway.hostUserId}>\n`;
    }

    const embed = new EmbedBuilder()
      .setTitle("Active giveaways")
      .setDescription(desc)
      .setColor(Color.Info);

    await interaction.reply({
      embeds: [embed],
    });
  }

  private async deleteGiveaway(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const giveawayId = interaction.options.getString(GiveawayOption.GiveawayID);
    if (!giveawayId) {
      throw new Error("No giveaway ID");
    }

    const deletedGiveaway = await this.giveawayService.deleteGiveaway(
      interaction.guildId,
      giveawayId,
    );

    if (!deletedGiveaway) {
      await interaction.reply(
        getErrorMessage(
          "Giveaway not found",
          "Please give a valid giveaway ID.",
        ),
      );
      return;
    }

    // Best effort, the giveaway is already deleted
    try {
      const channel = await this.getGiveawayChannel(
        interaction,
        deletedGiveaway.channelId,
      );
      if (channel) {
        await channel.messages.delete(deletedGiveaway.id);
      }
    } catch (err) {
      this.logger.warn(
        { err, giveawayId: deletedGiveaway.id },
        "Failed to delete giveaway message",
      );
    }

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Giveaway deleted!")
          .setColor(Color.Success)
          .toJSON(),
      ],
    });
  }

  private async endGiveaway(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const giveawayId = interaction.options.getString(
      GiveawayOption.GiveawayID,
      true,
    );

    const giveaway = await this.giveawayService.getGiveaway(
      interaction.guildId,
      giveawayId,
    );

    if (!giveaway) {
      await interaction.reply(
        getErrorMessage(
          "Giveaway not found",
          "Please give a valid giveaway ID.",
        ),
      );
      return;
    }

    if (giveaway.isEnded) {
      await interaction.reply(
        getErrorMessage(
          "Giveaway already ended",
          "This giveaway has already ended. You can reroll it with `/giveaway reroll`.",
        ),
      );
      return;
    }

    // defer: fetches the giveaway channel, edits the giveaway message and posts the winners announcement
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Runs on the cluster owning this guild, so buffered entries are flushed
    // before drawing. Claims the giveaway atomically so it can't race
    // GiveawayTask.
    const endResult = await this.giveawayEndService.endGiveaway(giveaway, {
      // Let the user fix channel permissions and try again
      endIfChannelUnavailable: false,
    });

    switch (endResult.status) {
      case "alreadyEnded":
        await interaction.editReply(
          getErrorMessageEdit(
            "Giveaway already ended",
            "This giveaway has already ended. You can reroll it with `/giveaway reroll`.",
          ),
        );
        return;
      case "channelUnavailable":
        await interaction.editReply(
          getErrorMessageEdit(
            "Channel not found",
            `Could not access the giveaway channel <#${giveaway.channelId}>. Make sure I can view and send messages there, then try again.`,
          ),
        );
        return;
      case "retry":
        await interaction.editReply(
          getErrorMessageEdit(
            "Failed to end giveaway",
            "Please try again in a few seconds.",
          ),
        );
        return;
      case "endedWithoutDraw":
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("Ended giveaway")
              .setDescription(
                "The giveaway channel is unavailable, so no winners were picked.",
              )
              .setColor(Color.Warning),
          ],
        });
        return;
      case "ended":
        break;
    }

    const { hasInsufficientWinners, reason } = endResult;

    if (hasInsufficientWinners && reason) {
      const embed = new EmbedBuilder()
        .setTitle("Not enough winners found")
        .setDescription(reason)
        .setColor(Color.Warning);

      await interaction.editReply({
        embeds: [embed],
      });
      return;
    }

    const responseEmbed = new EmbedBuilder()
      .setTitle("Ended giveaway")
      .setColor(Color.Success);

    await interaction.editReply({
      embeds: [responseEmbed],
    });
  }

  private async rerollGiveaway(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const giveawayId = interaction.options.getString(
      GiveawayOption.GiveawayID,
      true,
    );
    const winnerCount = interaction.options.getNumber(GiveawayOption.Winners);
    const allowRepeatWinners = interaction.options.getBoolean(
      GiveawayOption.AllowRepeatWinners,
    );

    const giveaway = await this.giveawayService.getGiveaway(
      interaction.guildId,
      giveawayId,
    );

    if (!giveaway) {
      await interaction.reply(
        getErrorMessage(
          "Giveaway not found",
          "Please give a valid giveaway ID.",
        ),
      );
      return;
    }

    if (!giveaway.isEnded) {
      await interaction.reply(
        getErrorMessage(
          "Giveaway not ended",
          "This giveaway has not ended yet. You can end it with `/giveaway end`.",
        ),
      );
      return;
    }

    const channel = await this.getGiveawayChannel(
      interaction,
      giveaway.channelId,
    );
    if (!channel) {
      await interaction.reply(
        getErrorMessage(
          "Channel not found",
          "Could not find the giveaway channel.",
        ),
      );
      return;
    }

    const { winnerIds, hasInsufficientWinners, reason } =
      await this.giveawayDrawService.drawWinners(
        giveaway,
        allowRepeatWinners || false,
        winnerCount || 1,
      );

    // Winners are already saved, so an announcement failure doesn't fail the
    // reroll
    if (winnerIds.length > 0) {
      try {
        await this.giveawayDrawService.sendWinnersMessage(
          channel,
          giveaway,
          winnerIds,
        );
      } catch (err) {
        this.logger.warn(
          { err, giveawayId: giveaway.id },
          "Failed to announce rerolled giveaway winners",
        );
      }
    }

    if (hasInsufficientWinners && reason) {
      const embed = new EmbedBuilder()
        .setTitle("Not enough winners found")
        .setDescription(reason)
        .setColor(Color.Warning);

      await interaction.reply({
        embeds: [embed],
        ephemeral: true,
      });
      return;
    }

    const responseEmbed = new EmbedBuilder()
      .setTitle("Giveaway rerolled!")
      .setColor(Color.Success);

    await interaction.reply({
      embeds: [responseEmbed],
      flags: MessageFlags.Ephemeral,
    });
  }

  private async getGiveawayChannel(
    interaction: ChatInputCommandInteraction<"cached">,
    channelId: string,
  ): Promise<GuildTextBasedChannel | null> {
    if (channelId === interaction.channelId) {
      return interaction.channel;
    }

    let channel;
    try {
      channel = await interaction.guild.channels.fetch(channelId);
    } catch (err) {
      if (
        err instanceof DiscordAPIError &&
        MISSING_CHANNEL_ERROR_CODES.has(err.code)
      ) {
        return null;
      }

      throw err;
    }

    if (!channel?.isTextBased()) {
      return null;
    }

    return channel;
  }
}
