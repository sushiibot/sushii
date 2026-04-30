import { ChannelType, PermissionFlagsBits } from "discord.js";

import type { PromptDefinition } from "../../domain/PromptDefinition";
import { makeCustomId } from "../../presentation/customIds";
import {
  FOLLOW_UPDATES_ID,
  buildFollowErrorMessage,
  buildFollowSuccessMessage,
  buildFollowUpdatesContent,
} from "./message";

// The channel must be of type Announcement (GuildAnnouncement) for following to work.
const UPDATES_CHANNEL_ID = "828010062383153192";

// TODO: Remove once feature is ready for all guilds
const ENABLED_GUILD_IDS = new Set(["167058919611564043"]);

const MOD_PERMISSIONS =
  PermissionFlagsBits.BanMembers |
  PermissionFlagsBits.KickMembers |
  PermissionFlagsBits.ModerateMembers;

export const followUpdatesPrompt: PromptDefinition = {
  id: FOLLOW_UPDATES_ID,
  scope: "guild",
  repeatCooldown: "daily",
  snoozeEnabled: true,

  async trigger(interaction) {
    if (!ENABLED_GUILD_IDS.has(interaction.guildId)) {
      return false;
    }
    if (!interaction.memberPermissions.any(MOD_PERMISSIONS)) {
      return false;
    }
    const channel = interaction.channel;
    if (!channel || !channel.isTextBased()) {
      return false;
    }
    const everyonePerms = channel.permissionsFor(interaction.guild.roles.everyone);
    if (everyonePerms?.has(PermissionFlagsBits.ViewChannel)) {
      return false;
    }
    return true;
  },

  buildContent(interaction) {
    const botHasManageWebhooks =
      interaction.guild.members.me?.permissions.has(PermissionFlagsBits.ManageWebhooks) ??
      false;
    return buildFollowUpdatesContent(botHasManageWebhooks);
  },

  async onSent(message, ctx) {
    // Handles the channel select only. Snooze/dismiss are handled globally by
    // PromptButtonHandler and are restart-safe via the InteractionRouter.
    const collector = message.createMessageComponentCollector({
      filter: (i) => i.customId === makeCustomId(FOLLOW_UPDATES_ID, "channel_select"),
      time: 15 * 60 * 1000,
      max: 1,
    });

    collector.on("collect", async (i) => {
      if (!i.isChannelSelectMenu() || !i.inCachedGuild()) {
        return;
      }
      const targetChannelId = i.values[0];
      if (!targetChannelId) {
        return;
      }

      await i.deferUpdate();

      try {
        const updatesChannel = await i.client.channels.fetch(UPDATES_CHANNEL_ID);
        if (!updatesChannel || updatesChannel.type !== ChannelType.GuildAnnouncement) {
          await i.editReply(buildFollowErrorMessage("Updates channel is unavailable."));
          return;
        }
        await updatesChannel.addFollower(targetChannelId);
        await ctx.promptService.recordCompleted(ctx.guildId, FOLLOW_UPDATES_ID);
        await i.editReply(buildFollowSuccessMessage(targetChannelId));
      } catch (error) {
        const msg =
          error instanceof Error && error.message.includes("Missing Permissions")
            ? "sushii needs the **Manage Webhooks** permission in that channel."
            : "Couldn't follow the updates channel. Check that sushii has **Manage Webhooks** permission.";
        await i.editReply(buildFollowErrorMessage(msg));
      }
    });
  },
};
