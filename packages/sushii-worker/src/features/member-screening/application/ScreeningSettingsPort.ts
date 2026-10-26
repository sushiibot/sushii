/** What server moderators can change in /settings. */
export interface ScreeningSettingsState {
  enabled: boolean;
  logChannelId: string | null;
  checkAvatars: boolean;
}

export interface ScreeningSettingsPort {
  /** Null when the member_screening flag is off for the guild: the settings section stays hidden. */
  getForSettings(guildId: string): Promise<ScreeningSettingsState | null>;
  /** Each setter creates the guild's screening row with defaults if it doesn't exist yet. */
  setLogChannel(guildId: string, channelId: string | null): Promise<void>;
  setCheckAvatars(guildId: string, checkAvatars: boolean): Promise<void>;
}
