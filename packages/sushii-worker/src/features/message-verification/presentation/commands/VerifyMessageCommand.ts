import type { ChatInputCommandInteraction } from "discord.js";
import {
  ContainerBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextDisplayBuilder,
} from "discord.js";
import type { Logger } from "pino";

import { SlashCommandHandler } from "@/shared/presentation/handlers";

import type { MessageVerificationService } from "../../application/MessageVerificationService";
import {
  createVerificationLookupMessage,
  createVerificationNotFoundMessage,
} from "../views/VerificationLookupView";

export class VerifyMessageCommand extends SlashCommandHandler {
  command = new SlashCommandBuilder()
    .setName("verify-message")
    .setDescription("Look up a message verification record by code.")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addStringOption((o) =>
      o
        .setName("code")
        .setDescription("The 8-character verification code to look up.")
        .setRequired(true),
    )
    .toJSON();

  constructor(
    private readonly verificationService: MessageVerificationService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not a cached guild interaction");
    }

    const rawCode = interaction.options.getString("code", true);
    const code = rawCode.trim().toUpperCase();

    const log = this.logger.child({
      command: "verifyMessage",
      guildId: interaction.guildId,
      userId: interaction.user.id,
      code,
    });

    log.info("Mod looked up verification code");

    try {
      const record = await this.verificationService.lookupByCode(code);

      if (!record) {
        await interaction.reply(createVerificationNotFoundMessage());
        return;
      }

      await interaction.reply(createVerificationLookupMessage(record));
    } catch (err) {
      this.logger.error(
        { err, guildId: interaction.guildId, userId: interaction.user.id, code },
        "Failed to look up verification code",
      );

      if (!interaction.replied && !interaction.deferred) {
        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            "Something went wrong while looking up the verification record. Please try again later.",
          ),
        );

        await interaction.reply({
          components: [container],
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        });
      }
    }
  }
}
