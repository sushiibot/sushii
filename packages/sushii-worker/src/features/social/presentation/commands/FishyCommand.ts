import { isDayjs } from "dayjs";
import type { ChatInputCommandInteraction } from "discord.js";
import { SlashCommandBuilder } from "discord.js";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain";
import { SlashCommandHandler } from "@/shared/presentation/handlers";

import type { FishyService } from "../../application";
import type { CollectionArtwork } from "../../infrastructure/CollectionArtwork";
import {
  createFishyCooldownMessage,
  createFishySuccessMessage,
} from "../views";

export class FishyCommand extends SlashCommandHandler {
  command = new SlashCommandBuilder()
    .setName("fishy")
    .setDescription("Catch some fish!")
    .addUserOption((o) =>
      o
        .setName("user")
        .setDescription("Who to fishy for or yourself if you have no friends")
        .setRequired(true),
    )
    .toJSON();

  constructor(
    private readonly fishyService: FishyService,
    private readonly artwork: CollectionArtwork,
    private readonly emojiRepository: BotEmojiRepository,
  ) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    const target = interaction.options.getUser("user", true);

    // Verify the configured pack before awarding a catch.
    await this.artwork.load();
    const result = await this.fishyService.fishyForUser(
      interaction.user,
      target,
      interaction.id,
    );
    const conditionEmoji = isDayjs(result)
      ? undefined
      : (
          await this.emojiRepository.getEmojis([
            `fishing_${result.condition}`,
          ] as const)
        )[`fishing_${result.condition}`];
    const message = isDayjs(result)
      ? createFishyCooldownMessage(result)
      : createFishySuccessMessage(
          result,
          target.id,
          (await this.artwork.url(result.collectibleId)) ??
            (await this.artwork.icon(result.collectibleId)),
          conditionEmoji,
        );
    await interaction.reply({
      components: message.components,
      files: message.files,
      allowedMentions: message.allowedMentions,
      flags: "IsComponentsV2",
    });
  }
}
