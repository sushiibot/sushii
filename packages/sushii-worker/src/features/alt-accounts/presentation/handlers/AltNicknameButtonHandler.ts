import type { ButtonInteraction, ModalSubmitInteraction } from "discord.js";
import {
  ActionRowBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { Logger } from "pino";

import { ButtonHandler } from "@/shared/presentation/handlers";

import { NICKNAME_MAX_LENGTH } from "../../application/SetNicknameService";
import type { SetNicknameService } from "../../application/SetNicknameService";
import { parseNicknameButtonId } from "../customIds";
import { buildAltIdentityContainer } from "../views";

export class AltNicknameButtonHandler extends ButtonHandler {
  customIDMatch = (customId: string) =>
    parseNicknameButtonId(customId) !== null
      ? { path: customId, index: 0, params: {} }
      : false;

  constructor(
    private readonly setNicknameService: SetNicknameService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handleInteraction(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not a guild interaction");
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers)) {
      await interaction.reply({
        content: "You need the Ban Members permission to do that.",
        ephemeral: true,
      });
      return;
    }

    const identityId = parseNicknameButtonId(interaction.customId);
    if (identityId === null) {
      throw new Error("No alt nickname button match");
    }

    const textInput = new TextInputBuilder()
      .setLabel("Nickname")
      .setRequired(false)
      .setMaxLength(NICKNAME_MAX_LENGTH)
      .setPlaceholder("Leave empty to clear the nickname")
      .setStyle(TextInputStyle.Short)
      .setCustomId("nickname");

    const row = new ActionRowBuilder<TextInputBuilder>().addComponents(
      textInput,
    );

    const modalCustomId = `${interaction.customId}/n/${interaction.id}`;

    await interaction.showModal({
      title: "Set Identity Nickname",
      custom_id: modalCustomId,
      components: [row.toJSON()],
    });

    let modalSubmission: ModalSubmitInteraction;
    try {
      modalSubmission = await interaction.awaitModalSubmit({
        time: 300_000,
        filter: (i) =>
          i.user.id === interaction.user.id && i.customId === modalCustomId,
      });
    } catch {
      this.logger.debug(
        { identityId, userId: interaction.user.id },
        "Alt nickname modal submission timed out",
      );
      return;
    }

    await this.processModalSubmission(modalSubmission, identityId);
  }

  private async processModalSubmission(
    interaction: ModalSubmitInteraction,
    identityId: number,
  ): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not a guild interaction");
    }

    const nicknameInput = interaction.fields.getTextInputValue("nickname");
    const nickname = nicknameInput.length > 0 ? nicknameInput : null;

    const result = await this.setNicknameService.setNicknameByIdentityId(
      interaction.guildId,
      identityId,
      nickname,
    );

    if (result.err) {
      await interaction.reply({
        content: `Failed to update nickname: ${result.val}`,
        ephemeral: true,
      });
      return;
    }

    if (!interaction.isFromMessage()) {
      throw new Error("Alt nickname modal should be from a button on a message");
    }

    await interaction.update({
      components: [buildAltIdentityContainer(result.val)],
      flags: ["IsComponentsV2"],
      allowedMentions: { parse: [] },
    });
  }
}
