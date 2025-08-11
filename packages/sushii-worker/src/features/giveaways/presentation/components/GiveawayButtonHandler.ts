import type { ButtonInteraction, InteractionResponse } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import type { Logger } from "pino";

import customIds from "@/interactions/customIds";
import { ButtonHandler } from "@/interactions/handlers";
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

    let alreadyEntered = alreadyInCache;
    if (!alreadyInCache) {
      const entryResult = await this.giveawayEntryService.hasUserEntered(
        interaction.message.id,
        interaction.user.id,
      );

      if (!entryResult.ok) {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("Error checking entry status")
              .setDescription("Please try again later.")
              .setColor(Color.Error),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      alreadyEntered = entryResult.val;
    }

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
    const giveawayResult = await this.giveawayService.getGiveaway(
      interaction.guildId,
      interaction.message.id,
    );

    if (!giveawayResult.ok) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("Error getting giveaway")
            .setDescription("Please try again later.")
            .setColor(Color.Error),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!giveawayResult.val) {
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

    const giveaway = giveawayResult.val;

    // Check eligibility
    const eligibilityResult =
      await this.giveawayEligibilityService.checkEligibility(
        giveaway,
        interaction.member,
      );

    if (!eligibilityResult.ok) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("Error checking eligibility")
            .setDescription("Please try again later.")
            .setColor(Color.Error),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const eligibility = eligibilityResult.val;

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

    try {
      // Call awaitMessageComponent on the message instead of interactionResponse
      const msg = await interactionResp.fetch();
      await msg.awaitMessageComponent({
        // 2 Minutes
        time: 1000 * 60 * 2,
      });
    } catch (_err) {
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

    const removeResult = await this.giveawayEntryService.removeEntry(
      giveawayId,
      userId,
    );

    const embed = new EmbedBuilder()
      .setTitle("Entry deleted")
      .setDescription(
        "You've deleted your giveaway entry. You can enter again by clicking the original giveaway button.",
      )
      .setColor(removeResult.ok ? Color.Success : Color.Error);

    await interactionResp.edit({
      embeds: [embed],
      components: [],
    });
  }
}
