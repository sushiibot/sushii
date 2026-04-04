export interface UserNotificationSettings {
  ignoreUnjoinedThreads: boolean;
}

export const DEFAULT_USER_NOTIFICATION_SETTINGS: UserNotificationSettings = {
  ignoreUnjoinedThreads: false,
};

export interface NotificationUserSettingsRepository {
  setIgnoreUnjoinedThreads(userId: string, value: boolean): Promise<void>;
  getSettingsForUsers(
    userIds: string[],
  ): Promise<Map<string, UserNotificationSettings>>;
}
