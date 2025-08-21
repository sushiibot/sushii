import type { ChatInputCommandInteraction } from "discord.js";
import {
  InteractionContextType,
  PermissionFlagsBits,
  PermissionsBitField,
  SlashCommandBuilder,
} from "discord.js";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis";
import { SlashCommandHandler } from "@/shared/presentation/handlers";

import type { HistoryUserService } from "../../application/HistoryUserService";
import {
  HISTORY_ACTION_EMOJIS,
  buildUserHistoryEmbeds,
} from "../views/HistoryView";

export class HistoryCommand extends SlashCommandHandler {
  requiredBotPermissions = new PermissionsBitField();

  command = new SlashCommandBuilder()
    .setName("history")
    .setDescription("Show the moderation case history for a user.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setContexts(InteractionContextType.Guild)
    .addUserOption((o) =>
      o
        .setName("user")
        .setDescription("The user to show moderation case history for.")
        .setRequired(true),
    )
    .toJSON();

  constructor(
    private readonly historyUserService: HistoryUserService,
    private readonly emojiRepository: BotEmojiRepository,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Guild not cached");
    }

    const user = interaction.options.getUser("user");
    if (!user) {
      throw new Error("No user provided");
    }

    const log = this.logger.child({
      guildId: interaction.guild.id,
      userId: user.id,
      executorId: interaction.user.id,
    });

    log.info("Processing history command");

    const historyResult = await this.historyUserService.getUserHistory(
      interaction.guild.id,
      user.id,
    );

    if (!historyResult.ok) {
      log.error({ error: historyResult.val }, "Failed to get user history");
      await interaction.reply({
        content: `Failed to get user history: ${historyResult.val}`,
        ephemeral: true,
      });
      return;
    }

    let member;
    try {
      // Can fail if user not in guild
      member = await interaction.guild.members.fetch(user.id);
    } catch (err) {
      // Ignore - user might not be in guild
      log.debug({ err }, "User not found in guild");
    }

    const emojis = await this.emojiRepository.getEmojis(HISTORY_ACTION_EMOJIS);

    const historyEmbeds = buildUserHistoryEmbeds(
      user,
      member || null,
      historyResult.val,
      emojis,
    );

    log.info(
      {
        totalCases: historyResult.val.totalCases,
        embedCount: historyEmbeds.length,
      },
      "History command completed successfully",
    );

    await interaction.reply({
      embeds: [historyEmbeds[0]],
    });

    // Send additional embeds if needed
    if (historyEmbeds.length > 1) {
      for (let i = 1; i < historyEmbeds.length; i += 1) {
        await interaction.followUp({
          embeds: [historyEmbeds[i]],
        });
      }
    }
  }
}
