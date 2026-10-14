import type { Guild } from "discord.js";
import { Events } from "discord.js";
import type { Logger } from "pino";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type { PermissionUsageRecorder } from "../../application/PermissionUsageRecorder";

export class GuildDeleteUsageHandler extends EventHandler<Events.GuildDelete> {
  readonly eventType = Events.GuildDelete;

  constructor(
    private readonly recorder: PermissionUsageRecorder,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handle(guild: Guild): Promise<void> {
    // GuildDelete also fires for outages, where the bot is still in the guild.
    if (!guild.available) {
      return;
    }

    try {
      await this.recorder.forgetGuild(guild.id);
    } catch (err) {
      this.logger.error(
        { err, guildId: guild.id },
        "Failed to delete permission usage for removed guild",
      );
    }
  }
}
