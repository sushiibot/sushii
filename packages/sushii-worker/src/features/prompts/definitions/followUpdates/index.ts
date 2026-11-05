import type { MessageComponentInteraction } from "discord.js";
import { MessageFlags, PermissionFlagsBits } from "discord.js";

import type { SushiiUpdatesService } from "@/features/sushii-updates/application/SushiiUpdatesService";
import {
  followErrorText,
  savedButNotFollowingText,
} from "@/features/sushii-updates/presentation/updatesText";
import type { GuildConfig } from "@/shared/domain/entities/GuildConfig";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import type { PromptDefinition } from "../../domain/PromptDefinition";
import {
  FOLLOW_UPDATES_ACTION,
  FOLLOW_UPDATES_ID,
  FOLLOW_UPDATES_SNOOZE_DAYS,
  buildFollowChannelContent,
  buildFollowErrorMessage,
  buildFollowSuccessMessage,
  buildPickChannelContent,
} from "./message";

export interface FollowUpdatesDependencies {
  updates: Pick<SushiiUpdatesService, "follow">;
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
const NO_CHANNEL_REASON =
  "Pick a sushii notifications channel in /settings → Logging first.";

function notificationsChannel(config: GuildConfig): string | null {
  const logs = config.loggingSettings;
  return logs.sushiiNotificationsEnabled
    ? logs.sushiiNotificationsChannel
    : null;
}

function pickedChannel(
  i: MessageComponentInteraction<"cached">,
): string | null {
  if (!i.isChannelSelectMenu()) {
    throw new Error("follow_updates channel picker is not a channel select", {
      cause: { customId: i.customId },
    });
  }
  return i.values[0] ?? null;
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
    return config.loggingSettings.sushiiUpdatesWebhookId === null;
  },

  async build(interaction) {
    if (!deps) {
      throw new Error(
        "follow_updates prompt built while sushii updates is off",
      );
    }
    const config = await deps.guildConfigRepository.findByGuildId(
      interaction.guildId,
    );
    const channelId = notificationsChannel(config);
    if (channelId) {
      return buildFollowChannelContent(channelId);
    }

    const botHasManageWebhooks =
      interaction.guild.members.me?.permissions.has(
        PermissionFlagsBits.ManageWebhooks,
      ) ?? false;
    return buildPickChannelContent(botHasManageWebhooks);
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
    const { updates, guildConfigRepository } = deps;

    const isPicker = action === FOLLOW_UPDATES_ACTION.pickChannel;
    if (!isPicker && action !== FOLLOW_UPDATES_ACTION.follow) {
      throw new Error("Unknown follow_updates action", { cause: { action } });
    }
    const picked = isPicker ? pickedChannel(i) : null;

    // defer: creates a follower webhook through Discord's API
    await i.deferUpdate();

    // The service serializes follows per guild, so a second click sees the first click's stored follow.
    const config = await guildConfigRepository.findByGuildId(i.guildId);
    const current = notificationsChannel(config);
    const alreadyIn = current ?? picked;
    if (config.loggingSettings.sushiiUpdatesWebhookId && alreadyIn) {
      await ctx.recordCompleted();
      await i.editReply(buildFollowSuccessMessage(alreadyIn));
      return;
    }

    const channelId = picked ?? current;
    if (!channelId) {
      await i.editReply(buildFollowErrorMessage(NO_CHANNEL_REASON));
      return;
    }

    if (picked) {
      await guildConfigRepository.save(
        config
          .updateLogChannel("notifications", picked)
          .setLoggingEnabled("notifications", true),
      );
    }

    const result = await updates.follow(i.guild, channelId, "prompt");
    if (result.err) {
      const reason = followErrorText(result.val, channelId);
      await i.editReply(
        buildFollowErrorMessage(
          picked ? `${savedButNotFollowingText(channelId)} ${reason}` : reason,
        ),
      );
      return;
    }

    await ctx.recordCompleted();
    await i.editReply(buildFollowSuccessMessage(channelId));
  },
};
