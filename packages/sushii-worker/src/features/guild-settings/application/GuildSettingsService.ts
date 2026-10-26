import type { Logger } from "pino";

import type { GuildConfig } from "@/shared/domain/entities/GuildConfig";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import type { GuildSettingsPatch } from "./SettingsPatch";

export class GuildSettingsService {
  constructor(
    private readonly guildConfigRepository: GuildConfigRepository,
    private readonly logger: Logger,
  ) {}

  async getGuildSettings(guildId: string): Promise<GuildConfig> {
    return this.guildConfigRepository.findByGuildId(guildId);
  }

  async apply(
    guildId: string,
    patch: GuildSettingsPatch,
  ): Promise<GuildConfig> {
    this.logger.info({ guildId, kind: patch.kind }, "Applying settings patch");

    const config = await this.guildConfigRepository.findByGuildId(guildId);

    return this.guildConfigRepository.save(applyPatch(config, patch));
  }
}

// The GuildConfig text updaters store "" as null.
function textOrClear(text: string | null): string {
  if (text === null || text.trim() === "") {
    return "";
  }

  return text;
}

function applyPatch(
  config: GuildConfig,
  patch: GuildSettingsPatch,
): GuildConfig {
  switch (patch.kind) {
    case "logChannel":
      return config
        .updateLogChannel(patch.log, patch.channelId)
        .setLoggingEnabled(patch.log, patch.channelId !== null);
    case "timeoutDm":
      return config
        .setTimeoutCommandDmEnabled(patch.commandEnabled)
        .setTimeoutNativeDmEnabled(patch.nativeEnabled)
        .updateTimeoutDmText(textOrClear(patch.text));
    case "warnDm":
      return config.updateWarnDmText(textOrClear(patch.text));
    case "banDm":
      return config
        .setBanDmEnabled(patch.enabled)
        .updateBanDmText(textOrClear(patch.text));
    case "kickDm":
      return config
        .setKickDmEnabled(patch.enabled)
        .updateKickDmText(textOrClear(patch.text));
    case "welcomeChannel":
      return config.updateMessageChannel(patch.channelId);
    case "joinMessage":
      return config
        .setJoinMessageEnabled(patch.enabled)
        .updateJoinMessage(textOrClear(patch.text));
    case "leaveMessage":
      return config
        .setLeaveMessageEnabled(patch.enabled)
        .updateLeaveMessage(textOrClear(patch.text));
    case "automodExemptRoles":
      // The guild ID is @everyone, which would exempt every member.
      return config.setAutomodExemptRoles(
        patch.roleIds.filter((id) => id !== config.guildId),
      );
    case "automodAlertsChannel":
      return config.setAutomodAlertsChannel(patch.channelId);
    case "flag":
      switch (patch.setting) {
        case "lookupOptIn":
          return config.setLookupOptInEnabled(patch.enabled);
        case "automodSpam":
          return config.setAutomodSpamEnabled(patch.enabled);
        case "automodScamImage":
          return config.setAutomodScamImageEnabled(patch.enabled);
      }
  }
}
