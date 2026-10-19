import type { ButtonInteraction, InteractionResponse } from "discord.js";
import {
  DiscordjsError,
  DiscordjsErrorCodes,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import type { Logger } from "pino";

import customIds from "@/interactions/customIds";
import { getErrorMessage } from "@/interactions/responses/error";
import { ButtonHandler } from "@/shared/presentation/handlers";
import Color from "@/utils/colors";

import type { GiveawayEligibilityService } from "../../application/GiveawayEligibilityService";
import type { GiveawayEntryCacheService } from "../../application/GiveawayEntryCacheService";
import type { GiveawayEntryService } from "../../application/GiveawayEntryService";
import type { GiveawayService } from "../../application/GiveawayService";
import { buildRemoveEntryComponents } from "../views/GiveawayComponentBuilder";

export class GiveawayButtonHandler extends ButtonHandler {
  customIDMatch = customIds.giveawayEnterButton.match;

  constructor(
    private readonly giveawayService: GiveawayService,
    private readonly giveawayEntryService: GiveawayEntryService,
    private readonly giveawayEntryCacheService: GiveawayEntryCacheService,
    private readonly giveawayEligibilityService: GiveawayEligibilityService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handleInteraction(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not a guild interaction");
    }

    // Check if user already entered (check cache first, then database)
    const alreadyInCache = this.giveawayEntryCacheService.isInCache(
      interaction.message.id,
      interaction.user.id,
    );

    const alreadyEntered =
      alreadyInCache ||
      (await this.giveawayEntryService.hasUserEntered(
        interaction.message.id,
        interaction.user.id,
      ));

    if (alreadyEntered) {
      const embed = new EmbedBuilder()
        .setTitle("You've already entered the giveaway!")
        .setDescription("You can remove your entry below.")
        .setColor(Color.Error);

      const components = buildRemoveEntryComponents();

      const deleteEntryMsg = await interaction.reply({
        embeds: [embed],
        components,
        flags: MessageFlags.Ephemeral,
      });

      await this.awaitRemoveEntryButton(
        deleteEntryMsg,
        interaction.message.id,
        interaction.user.id,
      );

      return;
    }

    // Get giveaway and check eligibility
    const giveaway = await this.giveawayService.getGiveaway(
      interaction.guildId,
      interaction.message.id,
    );

    if (!giveaway) {
      const embed = new EmbedBuilder()
        .setTitle("Giveaway not found")
        .setDescription(
          "Hmm... I either couldn't find this giveaway or it might have been deleted.",
        )
        .setColor(Color.Error);

      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });

      return;
    }

    // Winners may already be drawn, so a new entry could never win
    if (giveaway.isEnded || giveaway.isExpired()) {
      await interaction.reply(
        getErrorMessage(
          "Giveaway ended",
          "This giveaway has already ended.",
          true,
        ),
      );
      return;
    }

    // Check eligibility
    const eligibility = await this.giveawayEligibilityService.checkEligibility(
      giveaway,
      interaction.member,
    );

    if (!eligibility.eligible) {
      const embed = new EmbedBuilder()
        .setTitle("You're not eligible to enter this giveaway :(")
        .setColor(Color.Error)
        .setDescription(eligibility.reason);

      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });

      return;
    }

    // Add entry to cache
    await this.giveawayEntryCacheService.addEntryToCache(
      giveaway.id,
      interaction.user.id,
      interaction.message,
    );

    const embed = new EmbedBuilder()
      .setTitle("You've entered the giveaway!")
      .setColor(Color.Success);

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  }

  private async awaitRemoveEntryButton(
    interactionResp: InteractionResponse<true>,
    giveawayId: string,
    userId: string,
  ): Promise<void> {
    this.logger.debug(
      {
        giveawayId,
        userId,
      },
      "Awaiting remove entry button",
    );

    // Call awaitMessageComponent on the message instead of interactionResponse
    const msg = await interactionResp.fetch();

    try {
      await msg.awaitMessageComponent({
        // 2 Minutes
        time: 1000 * 60 * 2,
      });
    } catch (err) {
      const timedOut =
        err instanceof DiscordjsError &&
        err.code === DiscordjsErrorCodes.InteractionCollectorError;
      if (!timedOut) {
        throw err;
      }

      this.logger.debug(
        {
          giveawayId,
          userId,
        },
        "Remove entry button timed out",
      );

      // Delete the message to remove giveaway entry
      await interactionResp.delete();
      return;
    }

    this.logger.debug(
      {
        giveawayId,
        userId,
      },
      "Remove entry button clicked, deleting giveaway entry",
    );

    await this.giveawayEntryService.removeEntry(giveawayId, userId);

    const embed = new EmbedBuilder()
      .setTitle("Entry deleted")
      .setDescription(
        "You've deleted your giveaway entry. You can enter again by clicking the original giveaway button.",
      )
      .setColor(Color.Success);

    await interactionResp.edit({
      embeds: [embed],
      components: [],
    });
  }
}
