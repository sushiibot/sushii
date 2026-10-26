import type { FeatureFlagRepository } from "@/features/feature-flags/domain/FeatureFlagRepository";

import type { ScreeningGuildRepository } from "../domain/repositories/ScreeningGuildRepository";
import type { ScreeningGuildSettings } from "../domain/types";
import { defaultScreeningSettings } from "../domain/types";
import type {
  ScreeningSettingsPort,
  ScreeningSettingsState,
} from "./ScreeningSettingsPort";

function toState(settings: ScreeningGuildSettings): ScreeningSettingsState {
  return {
    enabled: settings.enabled,
    logChannelId: settings.logChannelId,
    checkAvatars: settings.checkAvatars,
  };
}

export class ScreeningSettingsService implements ScreeningSettingsPort {
  constructor(
    private readonly flagRepo: Pick<FeatureFlagRepository, "isEnabled">,
    private readonly guildRepo: Pick<
      ScreeningGuildRepository,
      "findByGuildId" | "patch"
    >,
  ) {}

  async getForSettings(
    guildId: string,
  ): Promise<ScreeningSettingsState | null> {
    if (!(await this.flagRepo.isEnabled(guildId, "member_screening"))) {
      return null;
    }

    return (
      (await this.getState(guildId)) ??
      toState(defaultScreeningSettings(guildId))
    );
  }

  /** The guild's saved state regardless of the flag; null when there's no row yet. */
  async getState(guildId: string): Promise<ScreeningSettingsState | null> {
    const settings = await this.guildRepo.findByGuildId(guildId);
    return settings ? toState(settings) : null;
  }

  async setLogChannel(
    guildId: string,
    channelId: string | null,
  ): Promise<void> {
    await this.guildRepo.patch(guildId, {
      logChannelId: channelId,
      enabled: channelId !== null,
    });
  }

  async setCheckAvatars(guildId: string, checkAvatars: boolean): Promise<void> {
    await this.guildRepo.patch(guildId, { checkAvatars });
  }
}
