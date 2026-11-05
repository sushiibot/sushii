import type { ModalSubmitInteraction } from "discord.js";

import type { IpGrabberSettingsState } from "@/features/ip-grabber-links/application/IpGrabberSettingsPort";
import type { ScreeningSettingsState } from "@/features/member-screening/application/ScreeningSettingsPort";
import type { GuildConfig } from "@/shared/domain/entities/GuildConfig";

import type { SettingsStatus } from "../../application/SettingsStatus";

export interface ModalContext {
  config: GuildConfig;
  status: SettingsStatus;
  screening: ScreeningSettingsState | null;
  ipGrabbers: IpGrabberSettingsState | null;
  /** False when this deployment has no sushii updates channel. */
  sushiiUpdatesAvailable: boolean;
  ignoredChannelIds: string[];
  /** The ignored channels shown in the msglog modal; every other stored ID is kept on submit. */
  prefilledIgnoredChannelIds: string[];
  prefilledExemptRoleIds: string[];
}

export type ModalSubmission = Pick<ModalSubmitInteraction, "fields">;
