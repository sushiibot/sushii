import type { Events, GuildBan } from "discord.js";
import { EmbedBuilder } from "discord.js";
import logger from "@/shared/infrastructure/logger";
import Color from "../../utils/colors";
import type { EventHandlerFn } from "../EventHandler";
import db from "../../infrastructure/database/db";
import { getGuildConfig } from "../../db/GuildConfig/GuildConfig.repository";

const notifiedCache = new Set<string>();

const legacyModLogNotifierHandler: EventHandlerFn<Events.GuildBanAdd> = async (
  ban: GuildBan,
): Promise<void> => {
  // Ban event
  // Ban event, exit if already sent notification
  if (notifiedCache.has(ban.guild.id)) {
    logger.debug(
      { guildId: ban.guild.id },
      "Already notified guild of missing audit log perms",
    );
    return;
  }

  const config = await getGuildConfig(db, ban.guild.id);

  // No guild config found, ignore
  if (
    !config || // Config not found
    !config.log_mod || // No msg log set
    !config.log_mod_enabled // Msg log disabled
  ) {
    return;
  }

  // Let's check if sushii has audit log perms in this guild.
  // Only fetch guild if not cached
  const hasAuditLogPerms =
    ban.guild.members.me?.permissions.has("ViewAuditLog");

  // Fine with perms
  if (hasAuditLogPerms) {
    return;
  }

  // sushii doesn't have audit log perms, notify
  // Guild doesn't have audit log perms, notify
  const embed = new EmbedBuilder()
    .setTitle("Missing audit log permissions")
    .setDescription(
      "sushii now needs extra permissions to log mod actions, please make sure my role has the `View Audit Log` permission!",
    )
    .setColor(Color.Error);

  const channel = ban.guild.channels.cache.get(config.log_mod);

  if (!channel || !channel.isTextBased()) {
    // Unknown channel, maybe deleted
    return;
  }

  await channel.send({
    embeds: [embed.toJSON()],
  });

  // Prevent logging again in this guild
  notifiedCache.add(ban.guild.id);

  logger.debug(
    { guildId: ban.guild.id },
    "Notified guild of missing audit log perms (ban event)",
  );
};

export default legacyModLogNotifierHandler;
