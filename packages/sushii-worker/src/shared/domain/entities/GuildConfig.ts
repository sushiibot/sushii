export interface MessageSettings {
  joinMessage: string | null;
  joinMessageEnabled: boolean;
  leaveMessage: string | null;
  leaveMessageEnabled: boolean;
  messageChannel: string | null;
}

export interface LoggingSettings {
  modLogChannel: string | null;
  modLogEnabled: boolean;
  memberLogChannel: string | null;
  memberLogEnabled: boolean;
  messageLogChannel: string | null;
  messageLogEnabled: boolean;
  reactionLogChannel: string | null;
  reactionLogEnabled: boolean;
}

export interface ModerationSettings {
  timeoutDmText: string | null;
  timeoutCommandDmEnabled: boolean;
  timeoutNativeDmEnabled: boolean;

  // Warn always dms
  warnDmText: string | null;

  banDmText: string | null;
  banDmEnabled: boolean;

  lookupDetailsOptIn: boolean;
  lookupPrompted: boolean;

  automodSpamEnabled: boolean;
}

export type ToggleableSetting =
  | "joinMessage"
  | "leaveMessage"
  | "modLog"
  | "memberLog"
  | "messageLog"
  | "reactionLog"
  | "lookupOptIn"
  | "timeoutCommandDm"
  | "timeoutNativeDm"
  | "banDm"
  | "automodSpam";

export class GuildConfig {
  constructor(
    public readonly guildId: string,
    public readonly prefix: string | null,
    public readonly messageSettings: MessageSettings,
    public readonly loggingSettings: LoggingSettings,
    public readonly moderationSettings: ModerationSettings,
    public readonly disabledChannels: string[],
  ) {}

  clone(): GuildConfig {
    return new GuildConfig(
      this.guildId,
      this.prefix,
      { ...this.messageSettings },
      { ...this.loggingSettings },
      { ...this.moderationSettings },
      [...this.disabledChannels],
    );
  }

  static createDefault(guildId: string): GuildConfig {
    return new GuildConfig(
      guildId,
      null,
      // Join and leave messages are enabled by default
      {
        joinMessage: null,
        joinMessageEnabled: true,
        leaveMessage: null,
        leaveMessageEnabled: true,
        messageChannel: null,
      },
      // Default logging are all enabled
      {
        modLogChannel: null,
        modLogEnabled: true,
        memberLogChannel: null,
        memberLogEnabled: true,
        messageLogChannel: null,
        messageLogEnabled: true,
        reactionLogChannel: null,
        reactionLogEnabled: true,
      },
      {
        timeoutDmText: null,
        timeoutCommandDmEnabled: true,
        timeoutNativeDmEnabled: true,

        warnDmText: null,

        banDmText: null,
        banDmEnabled: true,

        // Lookup flags
        lookupDetailsOptIn: false,
        lookupPrompted: false,

        // Automod settings
        automodSpamEnabled: false,
      },
      [],
    );
  }

  updateJoinMessage(message: string): GuildConfig {
    const config = this.clone();
    if (message === "") {
      // Should not be empty string
      config.messageSettings.joinMessage = null;
      return config;
    }

    config.messageSettings.joinMessage = message;
    return config;
  }

  updateLeaveMessage(message: string): GuildConfig {
    const config = this.clone();
    if (message === "") {
      // Should not be empty string
      config.messageSettings.leaveMessage = null;
      return config;
    }

    config.messageSettings.leaveMessage = message;
    return config;
  }

  updateTimeoutDmText(text: string): GuildConfig {
    const config = this.clone();
    if (text === "") {
      config.moderationSettings.timeoutDmText = null;
      return config;
    }

    config.moderationSettings.timeoutDmText = text;
    return config;
  }

  updateWarnDmText(text: string): GuildConfig {
    const config = this.clone();
    if (text === "") {
      config.moderationSettings.warnDmText = null;
      return config;
    }

    config.moderationSettings.warnDmText = text;
    return config;
  }

  updateBanDmText(text: string): GuildConfig {
    const config = this.clone();
    if (text === "") {
      config.moderationSettings.banDmText = null;
      return config;
    }

    config.moderationSettings.banDmText = text;
    return config;
  }

  updateMessageChannel(channelId: string | null): GuildConfig {
    const config = this.clone();
    config.messageSettings.messageChannel = channelId;
    return config;
  }

  setJoinMessageEnabled(enabled: boolean): GuildConfig {
    const config = this.clone();
    config.messageSettings.joinMessageEnabled = enabled;
    return config;
  }

  setLeaveMessageEnabled(enabled: boolean): GuildConfig {
    const config = this.clone();
    config.messageSettings.leaveMessageEnabled = enabled;
    return config;
  }

  updateLogChannel(
    type: "mod" | "member" | "message" | "reaction",
    channelId: string | null,
  ): GuildConfig {
    const config = this.clone();

    switch (type) {
      case "mod":
        config.loggingSettings.modLogChannel = channelId;
        break;
      case "member":
        config.loggingSettings.memberLogChannel = channelId;
        break;
      case "message":
        config.loggingSettings.messageLogChannel = channelId;
        break;
      case "reaction":
        config.loggingSettings.reactionLogChannel = channelId;
        break;
    }

    return config;
  }

  setLoggingEnabled(
    type: "mod" | "member" | "message" | "reaction",
    enabled: boolean,
  ): GuildConfig {
    const config = this.clone();

    switch (type) {
      case "mod":
        config.loggingSettings.modLogEnabled = enabled;
        break;
      case "member":
        config.loggingSettings.memberLogEnabled = enabled;
        break;
      case "message":
        config.loggingSettings.messageLogEnabled = enabled;
        break;
      case "reaction":
        config.loggingSettings.reactionLogEnabled = enabled;
        break;
    }

    return config;
  }

  setModLogEnabled(enabled: boolean): GuildConfig {
    const config = this.clone();
    config.loggingSettings.modLogEnabled = enabled;
    return config;
  }

  setMemberLogEnabled(enabled: boolean): GuildConfig {
    const config = this.clone();
    config.loggingSettings.memberLogEnabled = enabled;
    return config;
  }

  setMessageLogEnabled(enabled: boolean): GuildConfig {
    const config = this.clone();
    config.loggingSettings.messageLogEnabled = enabled;
    return config;
  }

  setReactionLogEnabled(enabled: boolean): GuildConfig {
    const config = this.clone();
    config.loggingSettings.reactionLogEnabled = enabled;
    return config;
  }

  setLookupOptInEnabled(enabled: boolean): GuildConfig {
    const config = this.clone();
    config.moderationSettings.lookupDetailsOptIn = enabled;
    return config;
  }

  setTimeoutCommandDmEnabled(enabled: boolean): GuildConfig {
    const config = this.clone();
    config.moderationSettings.timeoutCommandDmEnabled = enabled;
    return config;
  }

  setTimeoutNativeDmEnabled(enabled: boolean): GuildConfig {
    const config = this.clone();
    config.moderationSettings.timeoutNativeDmEnabled = enabled;
    return config;
  }

  setBanDmEnabled(enabled: boolean): GuildConfig {
    const config = this.clone();
    config.moderationSettings.banDmEnabled = enabled;
    return config;
  }

  setAutomodSpamEnabled(enabled: boolean): GuildConfig {
    const config = this.clone();
    config.moderationSettings.automodSpamEnabled = enabled;
    return config;
  }
}
