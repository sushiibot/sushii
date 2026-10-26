import type { FeatureFlagRepository } from "@/features/feature-flags/domain/FeatureFlagRepository";

import { isScreeningActive } from "../domain/isScreeningActive";
import type { ScreeningGuildRepository } from "../domain/repositories/ScreeningGuildRepository";
import type { ActiveScreeningSettings } from "../domain/types";

export class ScreeningActivation {
  constructor(
    private readonly flagRepo: Pick<FeatureFlagRepository, "isEnabled">,
    private readonly guildRepo: Pick<ScreeningGuildRepository, "findByGuildId">,
  ) {}

  /** The guild's settings when screening is active, otherwise null. Throws when flags can't be loaded, so hot-path callers must guard. */
  async activeSettings(
    guildId: string,
  ): Promise<ActiveScreeningSettings | null> {
    if (!(await this.flagEnabled(guildId))) {
      return null;
    }

    const settings = await this.guildRepo.findByGuildId(guildId);
    return isScreeningActive(true, settings) ? settings : null;
  }

  flagEnabled(guildId: string): Promise<boolean> {
    return this.flagRepo.isEnabled(guildId, "member_screening");
  }
}
