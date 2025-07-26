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
}

export type ToggleableSetting =
  | "joinMessage"
  | "leaveMessage"
  | "modLog"
  | "memberLog"
  | "messageLog"
  | "lookupOptIn"
  | "timeoutCommandDm"
  | "timeoutNativeDm"
  | "banDm";

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
      },
      [],
    );
  }

  updateJoinMessage(message: string): GuildConfig {
    const config = this.clone();
    if (message === "") {
      // Should not be empty string
      config.messageSettings.leaveMessage = null;
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

  updateMessageChannel(channelId: string): GuildConfig {
    const config = this.clone();
    config.messageSettings.messageChannel = channelId;
    return config;
  }

  toggleJoinMessage(): GuildConfig {
    const config = this.clone();
    config.messageSettings.joinMessageEnabled =
      !config.messageSettings.joinMessageEnabled;
    return config;
  }

  toggleLeaveMessage(): GuildConfig {
    const config = this.clone();
    config.messageSettings.leaveMessageEnabled =
      !config.messageSettings.leaveMessageEnabled;
    return config;
  }

  updateLogChannel(
    type: "mod" | "member" | "message",
    channelId: string,
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
    }

    return config;
  }

  toggleLogging(type: "mod" | "member" | "message"): GuildConfig {
    const config = this.clone();

    switch (type) {
      case "mod":
        config.loggingSettings.modLogEnabled =
          !config.loggingSettings.modLogEnabled;
        break;
      case "member":
        config.loggingSettings.memberLogEnabled =
          !config.loggingSettings.memberLogEnabled;
        break;
      case "message":
        config.loggingSettings.messageLogEnabled =
          !config.loggingSettings.messageLogEnabled;
        break;
    }

    return config;
  }

  toggleModLog(): GuildConfig {
    const config = this.clone();
    config.loggingSettings.modLogEnabled =
      !config.loggingSettings.modLogEnabled;
    return config;
  }

  toggleMemberLog(): GuildConfig {
    const config = this.clone();
    config.loggingSettings.memberLogEnabled =
      !config.loggingSettings.memberLogEnabled;
    return config;
  }

  toggleMessageLog(): GuildConfig {
    const config = this.clone();
    config.loggingSettings.messageLogEnabled =
      !config.loggingSettings.messageLogEnabled;
    return config;
  }

  toggleLookupOptIn(): GuildConfig {
    const config = this.clone();
    config.moderationSettings.lookupDetailsOptIn =
      !config.moderationSettings.lookupDetailsOptIn;
    return config;
  }

  toggleTimeoutCommandDm(): GuildConfig {
    const config = this.clone();
    config.moderationSettings.timeoutCommandDmEnabled =
      !config.moderationSettings.timeoutCommandDmEnabled;
    return config;
  }

  toggleTimeoutNativeDm(): GuildConfig {
    const config = this.clone();
    config.moderationSettings.timeoutNativeDmEnabled =
      !config.moderationSettings.timeoutNativeDmEnabled;
    return config;
  }

  toggleBanDm(): GuildConfig {
    const config = this.clone();
    config.moderationSettings.banDmEnabled =
      !config.moderationSettings.banDmEnabled;
    return config;
  }
}
