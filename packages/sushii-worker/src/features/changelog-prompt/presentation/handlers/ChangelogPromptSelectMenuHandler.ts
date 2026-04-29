import type { AnySelectMenuInteraction, Client } from "discord.js";
import { ChannelType } from "discord.js";
import type { Logger } from "pino";

import { SelectMenuHandler } from "@/shared/presentation/handlers";

import type { ChangelogPromptService } from "../../application/ChangelogPromptService";
import { CUSTOM_IDS, UPDATES_CHANNEL_ID } from "../ChangelogPromptConstants";
import {
  buildFollowErrorMessage,
  buildFollowSuccessMessage,
} from "../views/ChangelogPromptMessageBuilder";

export class ChangelogPromptSelectMenuHandler extends SelectMenuHandler {
  customIDMatch = (customId: string) => {
    if (customId === CUSTOM_IDS.CHANNEL_SELECT) {
      return { path: customId, index: 0, params: {} };
    }
    return false;
  };

  constructor(
    private readonly changelogPromptService: ChangelogPromptService,
    private readonly client: Client,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handleInteraction(interaction: AnySelectMenuInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not a guild interaction");
    }
    if (!interaction.isChannelSelectMenu()) {
      return;
    }

    const targetChannelId = interaction.values[0];
    if (!targetChannelId) {
      return;
    }

    await interaction.deferUpdate();

    const guildId = BigInt(interaction.guildId);

    if (UPDATES_CHANNEL_ID === "TODO") {
      this.logger.warn("Changelog updates channel ID not configured");
      await interaction.editReply(
        buildFollowErrorMessage("Updates channel not configured yet."),
      );
      return;
    }

    try {
      const updatesChannel = await this.client.channels.fetch(UPDATES_CHANNEL_ID);
      if (!updatesChannel || updatesChannel.type !== ChannelType.GuildAnnouncement) {
        await interaction.editReply(
          buildFollowErrorMessage("Updates channel is unavailable."),
        );
        return;
      }

      await updatesChannel.addFollower(targetChannelId);
      await this.changelogPromptService.recordFollowed(guildId);
      await interaction.editReply(buildFollowSuccessMessage(targetChannelId));
    } catch (error) {
      this.logger.error(
        { err: error, guildId, targetChannelId },
        "Failed to follow updates channel",
      );

      const message =
        error instanceof Error && error.message.includes("Missing Permissions")
          ? "sushii needs the **Manage Webhooks** permission in that channel."
          : "Couldn't follow the updates channel. Check that sushii has **Manage Webhooks** permission.";

      await interaction.editReply(buildFollowErrorMessage(message));
    }
  }
}
