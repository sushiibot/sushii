import type { GuildBan } from "discord.js";
import { EmbedBuilder } from "discord.js";
import type { Logger } from "pino";

import { getGuildConfig } from "@/db/GuildConfig/GuildConfig.repository";
import db from "@/infrastructure/database/db";
import Color from "@/utils/colors";

/**
 * Service for handling legacy audit log permission notifications.
 * Notifies guilds when the bot lacks audit log permissions for proper mod logging.
 */
export class LegacyAuditLogNotificationService {
  private readonly notifiedCache = new Set<string>();

  constructor(
    private readonly logger: Logger,
  ) {}

  /**
   * Handles a guild ban event and potentially sends an audit log permission notification.
   */
  async handleBanEvent(ban: GuildBan): Promise<void> {
    // Exit if already sent notification for this guild
    if (this.notifiedCache.has(ban.guild.id)) {
      this.logger.debug(
        { guildId: ban.guild.id },
        "Already notified guild of missing audit log perms",
      );
      return;
    }

    const config = await getGuildConfig(db, ban.guild.id);

    // No guild config found, or mod log not configured/enabled
    if (
      !config ||
      !config.log_mod ||
      !config.log_mod_enabled
    ) {
      return;
    }

    // Check if bot has audit log permissions
    const hasAuditLogPerms = ban.guild.members.me?.permissions.has("ViewAuditLog");

    // Bot has permissions, no notification needed
    if (hasAuditLogPerms) {
      return;
    }

    // Send notification about missing permissions
    await this.sendPermissionNotification(ban, config.log_mod);
  }

  private async sendPermissionNotification(ban: GuildBan, logChannelId: string): Promise<void> {
    const channel = ban.guild.channels.cache.get(logChannelId);

    if (!channel || !channel.isTextBased()) {
      // Channel not found or not text-based, skip notification
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("Missing audit log permissions")
      .setDescription(
        "sushii now needs extra permissions to log mod actions, please make sure my role has the `View Audit Log` permission!"
      )
      .setColor(Color.Error);

    try {
      await channel.send({
        embeds: [embed.toJSON()],
      });
    } catch (error) {
      this.logger.error(
        { err: error, guildId: ban.guild.id, channelId: logChannelId },
        "Failed to send audit log permission notification",
      );
    }

    // Mark guild as notified to prevent spam (matches original behavior)
    this.notifiedCache.add(ban.guild.id);

    this.logger.debug(
      { guildId: ban.guild.id },
      "Notified guild of missing audit log perms (ban event)",
    );
  }
}