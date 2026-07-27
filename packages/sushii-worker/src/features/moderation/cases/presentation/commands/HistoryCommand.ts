import type { ChatInputCommandInteraction, GuildMember } from "discord.js";
import {
  InteractionContextType,
  PermissionFlagsBits,
  PermissionsBitField,
  SlashCommandBuilder,
} from "discord.js";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis";
import { ComponentsV2Paginator } from "@/shared/presentation/ComponentsV2Paginator";
import { SlashCommandHandler } from "@/shared/presentation/handlers";

import type { HistoryUserService } from "../../application/HistoryUserService";
import {
  HISTORY_ACTION_EMOJIS,
  buildHistoryPageContainer,
  buildHistoryPages,
  spansMultipleUsers,
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

    let member: GuildMember | undefined;
    try {
      // Can fail if user not in guild
      member = await interaction.guild.members.fetch(user.id);
    } catch (err) {
      // Ignore - user might not be in guild
      log.debug({ err }, "User not found in guild");
    }

    const emojis = await this.emojiRepository.getEmojis(HISTORY_ACTION_EMOJIS);

    // Newest-first, so page 1 is packed with the most recent cases and later
    // pages hold progressively older ones — the most relevant cases surface
    // first regardless of which linked account they're on.
    const casesNewestFirst = [...historyResult.val.moderationHistory].reverse();

    // Only tag each case with its target when the cases actually span more
    // than one linked account — computed once and reused for both packing
    // (buildHistoryPages) and rendering (buildHistoryPageContainer) so they
    // can't disagree on how long a page's rendered text will be.
    const showTargetMention = spansMultipleUsers(casesNewestFirst);

    // Pages are pre-packed by rendered character length (a case's reason can
    // run up to 1024 chars and isn't truncated), so each "page" from the
    // paginator's perspective is one whole bin — pageSize is fixed at 1 bin.
    const pages = buildHistoryPages(casesNewestFirst, emojis, showTargetMention);

    const paginator = new ComponentsV2Paginator({
      interaction,
      pageSize: 1,
      callbacks: {
        // Each bin was packed newest-first; reverse it for display so a page
        // reads like a chat log — oldest case at the top, newest at the
        // bottom — while page 1 still holds the most recent cases overall.
        fetchPage: async (pageIndex) =>
          pages[pageIndex] ? [[...pages[pageIndex]].reverse()] : [],
        getTotalCount: async () => pages.length,
        renderContainer: ([pageCases], state, navButtons) =>
          buildHistoryPageContainer(
            user,
            member || null,
            historyResult.val,
            pageCases ?? [],
            emojis,
            showTargetMention,
            navButtons,
            state.isDisabled,
          ),
      },
    });

    await paginator.start(false);

    log.info(
      { totalCases: historyResult.val.totalCases },
      "History command completed successfully",
    );
  }
}
