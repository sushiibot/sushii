import type { Guild, MessageComponentInteraction } from "discord.js";
import { MessageFlags, PermissionFlagsBits } from "discord.js";

import type { GuildConfig } from "@/shared/domain/entities/GuildConfig";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import type { PromptDefinition } from "../../domain/PromptDefinition";
import {
  FOLLOW_UPDATES_ACTION,
  FOLLOW_UPDATES_ID,
  FOLLOW_UPDATES_SNOOZE_DAYS,
  buildNotificationsOnMessage,
  buildPickChannelContent,
  cantSendText,
} from "./message";

export interface FollowUpdatesDependencies {
  guildConfigRepository: GuildConfigRepository;
}

// Prompt definitions are static, so the feature's services are handed in at startup.
let deps: FollowUpdatesDependencies | null = null;

/** Null (the default) keeps the prompt from ever being offered. */
export function configureFollowUpdatesPrompt(
  dependencies: FollowUpdatesDependencies | null,
): void {
  deps = dependencies;
}

const FEATURE_OFF_REPLY = "sushii updates aren't available right now.";

function hasNotificationsChannel(config: GuildConfig): boolean {
  const logs = config.loggingSettings;
  return logs.sushiiNotificationsEnabled && !!logs.sushiiNotificationsChannel;
}

function canSendIn(guild: Guild, channelId: string): boolean {
  const channel = guild.channels.cache.get(channelId);
  const me = guild.members.me;
  if (!channel || !me || !channel.isSendable()) {
    return false;
  }
  return (
    channel
      .permissionsFor(me)
      ?.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
      ]) ?? false
  );
}

function pickedChannel(i: MessageComponentInteraction<"cached">): string {
  const picked = i.isChannelSelectMenu() ? i.values[0] : undefined;
  if (!picked) {
    throw new Error("follow_updates channel picker sent no channel", {
      cause: { customId: i.customId },
    });
  }
  return picked;
}

export const followUpdatesPrompt: PromptDefinition = {
  id: FOLLOW_UPDATES_ID,
  scope: "guild",
  repeat: { days: 30 },
  snoozeDays: FOLLOW_UPDATES_SNOOZE_DAYS,
  delivery: "auto",

  async eligible(interaction) {
    if (!deps) {
      return false;
    }
    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
      return false;
    }
    const config = await deps.guildConfigRepository.findByGuildId(
      interaction.guildId,
    );
    return !hasNotificationsChannel(config);
  },

  build() {
    return buildPickChannelContent();
  },

  canAct(interaction) {
    return interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild);
  },

  async handleAction(i, action, ctx) {
    // An old prompt can still be clicked after the feature is turned off.
    if (!deps) {
      await i.reply({
        content: FEATURE_OFF_REPLY,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (action !== FOLLOW_UPDATES_ACTION.pickChannel) {
      throw new Error("Unknown follow_updates action", { cause: { action } });
    }

    const channelId = pickedChannel(i);
    if (!canSendIn(i.guild, channelId)) {
      await i.reply({
        content: cantSendText(channelId),
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }

    const { guildConfigRepository } = deps;
    const config = await guildConfigRepository.findByGuildId(i.guildId);
    await guildConfigRepository.save(
      config
        .updateLogChannel("notifications", channelId)
        .setLoggingEnabled("notifications", true),
    );

    await ctx.recordCompleted();
    await i.update(
      buildNotificationsOnMessage(
        channelId,
        config.loggingSettings.sushiiUpdatesEnabled,
      ),
    );
  },
};
