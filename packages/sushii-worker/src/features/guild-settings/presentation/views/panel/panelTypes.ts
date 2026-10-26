import type { SettingsStatus } from "@/features/guild-settings/application/SettingsStatus";
import type { ScreeningSettingsState } from "@/features/member-screening/application/ScreeningSettingsPort";
import type { GuildConfig } from "@/shared/domain/entities/GuildConfig";

import type { SettingsTab } from "../../session/settingsIds";
import type { MessagePreviewContext } from "./messagePreview";
import type { PanelEmojis } from "./panelParts";

export interface PanelInput {
  tab: SettingsTab;
  config: GuildConfig;
  status: SettingsStatus;
  screening: ScreeningSettingsState | null;
  ignoredChannelIds: string[];
  emojis: PanelEmojis;
  expired: boolean;
  /** Fills the join/leave placeholders. */
  preview: MessagePreviewContext;
}
