import type { Guild } from "discord.js";

import type { IpGrabberSyncError } from "../domain/IpGrabberRepository";
import type { IpGrabberProviderId } from "../domain/providers";

export interface KeywordRuleOption {
  id: string;
  name: string;
  keywordCount: number;
}

export interface IpGrabberSettingsState {
  ruleId: string | null;
  ruleName: string | null;
  providers: IpGrabberProviderId[];
  keywordCount: number;
  lastSyncedAt: Date | null;
  problem: IpGrabberSyncError | null;
  /** The guild's keyword rules; empty when `rulesError` is set. */
  rules: KeywordRuleOption[];
  rulesError: "missing_permission" | "unavailable" | null;
}

export interface IpGrabberSettingsPort {
  getForSettings(guild: Guild): Promise<IpGrabberSettingsState>;
  /** A null rule turns the feature off and removes sushii's keywords. */
  configure(
    guildId: string,
    input: { ruleId: string | null; providers: IpGrabberProviderId[] },
  ): Promise<void>;
}
