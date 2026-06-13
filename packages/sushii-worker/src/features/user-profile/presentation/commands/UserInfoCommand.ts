import type { ChatInputCommandInteraction, Client } from "discord.js";
import { SlashCommandBuilder } from "discord.js";
import type { Logger } from "pino";

import type { UserLevelRepository } from "@/features/leveling/domain/repositories/UserLevelRepository";
import { SlashCommandHandler } from "@/shared/presentation/handlers";

import { createUserInfoEmbed } from "../views/UserInfoView";

export class UserInfoCommand extends SlashCommandHandler {
  serverOnly = false;

  command = new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("Get information about a user")
    .addUserOption((o) =>
      o
        .setName("user")
        .setDescription(
          "The user to get information about, yourself if not provided",
        ),
    )
    .toJSON();

  constructor(
    private readonly client: Client,
    private readonly logger: Logger,
    private readonly userLevelRepository: UserLevelRepository,
  ) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    let target = interaction.options.getUser("user");

    if (!target) {
      target = interaction.user;
    }

    try {
      const user = await this.client.users.fetch(target.id);

      let member;
      if (interaction.inCachedGuild()) {
        try {
          member = await interaction.guild.members.fetch(target.id);
        } catch {
          // Member not in guild, continue without member info
        }
      }

      const [guildLevelResult, globalLevelResult] = await Promise.allSettled([
        interaction.guildId
          ? this.userLevelRepository.getUserGuildLevel(
              interaction.guildId,
              target.id,
            )
          : Promise.resolve(null),
        this.userLevelRepository.getUserGlobalLevel(target.id),
      ]);

      const guildLevel =
        guildLevelResult.status === "fulfilled" ? guildLevelResult.value : null;
      const globalLevel =
        globalLevelResult.status === "fulfilled"
          ? globalLevelResult.value
          : null;

      if (guildLevelResult.status === "rejected") {
        this.logger.error(
          { err: guildLevelResult.reason, userId: target.id, guildId: interaction.guildId },
          "Failed to fetch guild level for userinfo",
        );
      }

      if (globalLevelResult.status === "rejected") {
        this.logger.error(
          { err: globalLevelResult.reason, userId: target.id },
          "Failed to fetch global level for userinfo",
        );
      }

      const embed = createUserInfoEmbed(user, member || undefined, guildLevel, globalLevel);

      this.logger.debug({ embed }, "userinfo embed");

      await interaction.reply({
        embeds: [embed],
      });
    } catch (error) {
      this.logger.error(
        { err: error, userId: target.id, guildId: interaction.guildId },
        "Failed to get user info",
      );

      throw new Error("Failed to fetch user information", { cause: error });
    }
  }
}
