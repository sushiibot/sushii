import type { Guild } from "discord.js";
import { Events } from "discord.js";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type { ServerAppearanceService } from "../../application/ServerAppearanceService";

/** Records renames from any source, including Discord's own settings, for /server name suggestions. */
export class ServerNameHistoryHandler extends EventHandler<Events.GuildUpdate> {
  readonly eventType = Events.GuildUpdate;

  constructor(private readonly appearanceService: ServerAppearanceService) {
    super();
  }

  async handle(oldGuild: Guild, newGuild: Guild): Promise<void> {
    if (oldGuild.name === newGuild.name) {
      return;
    }

    await this.appearanceService.recordNameChange(
      newGuild.id,
      oldGuild.name,
      newGuild.name,
    );
  }
}
