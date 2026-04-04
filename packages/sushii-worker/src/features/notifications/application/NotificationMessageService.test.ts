import { describe, expect, mock, test } from "bun:test";
import type { Message } from "discord.js";
import { ChannelType, DiscordAPIError, RESTJSONErrorCodes } from "discord.js";
import type { Logger } from "pino";

import { Notification } from "../domain/entities/Notification";
import type { UserNotificationSettings } from "../domain/repositories/NotificationUserSettingsRepository";
import { NotificationMetrics } from "../infrastructure/metrics/NotificationMetrics";
import { NotificationMessageService } from "./NotificationMessageService";
import type { NotificationService } from "./NotificationService";

describe("NotificationMessageService", () => {
  const mockNotificationService = {
    findMatchingNotifications: mock<
      NotificationService["findMatchingNotifications"]
    >(() => Promise.resolve([])),
    cleanupMemberLeft: mock<NotificationService["cleanupMemberLeft"]>(() =>
      Promise.resolve(),
    ),
    getUserSettingsMap: mock<NotificationService["getUserSettingsMap"]>(() =>
      Promise.resolve(new Map()),
    ),
  };

  const mockLogger = {
    debug: mock(),
    error: mock(),
  };

  const mockMetrics = new NotificationMetrics(() => Promise.resolve(0));

  const service = new NotificationMessageService(
    mockNotificationService as unknown as NotificationService,
    mockLogger as unknown as Logger,
    mockMetrics,
  );

  test("ignores bot messages", async () => {
    const mockMessage = {
      inGuild: () => true,
      author: { bot: true, id: "bot123" },
      content: "test message",
    };

    await service.processMessage(mockMessage as unknown as Message);

    expect(
      mockNotificationService.findMatchingNotifications,
    ).not.toHaveBeenCalled();
  });

  test("ignores DM messages", async () => {
    const mockMessage = {
      inGuild: () => false,
      author: { bot: false, id: "user123" },
      content: "test message",
    };

    await service.processMessage(mockMessage as unknown as Message);

    expect(
      mockNotificationService.findMatchingNotifications,
    ).not.toHaveBeenCalled();
  });

  test("ignores messages without content", async () => {
    const mockMessage = {
      inGuild: () => true,
      author: { bot: false, id: "user123" },
      content: "",
    };

    await service.processMessage(mockMessage as unknown as Message);

    expect(
      mockNotificationService.findMatchingNotifications,
    ).not.toHaveBeenCalled();
  });

  test("processes valid messages", async () => {
    const notifications = [
      Notification.create("guild1", "user1", "test"),
      Notification.create("guild1", "user2", "hello"),
    ];
    mockNotificationService.findMatchingNotifications.mockResolvedValue(
      notifications,
    );

    const mockMessage = {
      inGuild: () => true,
      author: { bot: false, id: "author123" },
      content: "test hello world",
      guildId: "guild1",
      channelId: "channel1",
      channel: { parentId: "category1", isThread: () => false },
    };

    await service.processMessage(mockMessage as unknown as Message);

    expect(
      mockNotificationService.findMatchingNotifications,
    ).toHaveBeenCalledWith(
      "guild1",
      "category1",
      "channel1",
      "author123",
      "test hello world",
    );
  });

  test("deduplicates notifications by user", async () => {
    const notifications = [
      Notification.create("guild1", "user1", "test"),
      Notification.create("guild1", "user1", "hello"), // duplicate user
      Notification.create("guild1", "user2", "world"),
    ];
    mockNotificationService.findMatchingNotifications.mockResolvedValue(
      notifications,
    );

    const mockGuild = {
      members: {
        fetch: mock((userId: string) => {
          if (userId === "user1" || userId === "user2") {
            return Promise.resolve({
              id: userId,
              send: mock(() => Promise.resolve()),
            });
          }
          return Promise.reject(new Error("Member not found"));
        }),
      },
    };

    const mockMessage = {
      inGuild: () => true,
      author: { bot: false, id: "author123" },
      content: "test hello world",
      guildId: "guild1",
      channelId: "channel1",
      channel: {
        parentId: "category1",
        isThread: () => false,
        permissionsFor: mock(() => ({ has: () => true })),
      },
      guild: mockGuild,
      url: "https://discord.com/channels/guild1/channel1/msg123",
      member: { displayAvatarURL: () => "avatar.png" },
    };

    await service.processMessage(mockMessage as unknown as Message);

    // Should only fetch 2 unique users, not 3
    expect(mockGuild.members.fetch).toHaveBeenCalledTimes(2);
    expect(mockGuild.members.fetch).toHaveBeenCalledWith("user1");
    expect(mockGuild.members.fetch).toHaveBeenCalledWith("user2");
  });

  test("cleans up notifications for missing members", async () => {
    const notifications = [Notification.create("guild1", "user1", "test")];
    mockNotificationService.findMatchingNotifications.mockResolvedValue(
      notifications,
    );

    const mockGuild = {
      members: {
        fetch: mock(() => {
          const error = new DiscordAPIError(
            {
              message: "Unknown Member",
              code: RESTJSONErrorCodes.UnknownMember,
            },
            RESTJSONErrorCodes.UnknownMember,
            404,
            "GET",
            "/guilds/guild1/members/user1",
            {},
          );
          return Promise.reject(error);
        }),
      },
    };

    const mockMessage = {
      inGuild: () => true,
      author: { bot: false, id: "author123" },
      content: "test message",
      guildId: "guild1",
      channelId: "channel1",
      channel: { parentId: "category1", isThread: () => false },
      guild: mockGuild,
    };

    await service.processMessage(mockMessage as unknown as Message);

    expect(mockNotificationService.cleanupMemberLeft).toHaveBeenCalledWith(
      "guild1",
      "user1",
    );
  });

  describe("public thread filtering (ignoreUnjoinedThreads)", () => {
    const userId = "user1";

    function makeThreadMessage(isMember: boolean) {
      const memberSend = mock(() => Promise.resolve());

      const mockGuild = {
        members: {
          fetch: mock((id: string) => {
            if (id === userId) {
              return Promise.resolve({
                id: userId,
                send: memberSend,
                displayAvatarURL: () => "avatar.png",
              });
            }
            return Promise.reject(new Error("Member not found"));
          }),
        },
      };

      const mockMessage = {
        inGuild: () => true,
        author: {
          bot: false,
          id: "author123",
          displayName: "Author",
          tag: "Author#0000",
          displayAvatarURL: () =>
            "https://cdn.discordapp.com/avatars/author123/abc.png",
        },
        content: "test keyword",
        guildId: "guild1",
        channelId: "thread1",
        channel: {
          parentId: "channel1",
          isThread: () => true,
          type: ChannelType.PublicThread,
          members: {
            fetch: mock(() => Promise.resolve()),
            cache: { has: mock((_id: string) => isMember) },
          },
          permissionsFor: mock(() => ({ has: () => true })),
        },
        guild: mockGuild,
        url: "https://discord.com/channels/guild1/thread1/msg123",
        member: null,
      };

      return { mockMessage, mockGuild, memberSend };
    }

    test("public thread + ignoreUnjoinedThreads: true + user IS a thread member → notification sent", async () => {
      const notifications = [Notification.create("guild1", userId, "keyword")];
      mockNotificationService.findMatchingNotifications.mockResolvedValue(
        notifications,
      );

      const settings: UserNotificationSettings = {
        ignoreUnjoinedThreads: true,
      };
      mockNotificationService.getUserSettingsMap.mockResolvedValue(
        new Map([[userId, settings]]),
      );

      const { mockMessage, memberSend } = makeThreadMessage(true);

      await service.processMessage(mockMessage as unknown as Message);

      expect(memberSend).toHaveBeenCalled();
    });

    test("public thread + ignoreUnjoinedThreads: true + user is NOT a thread member → notification suppressed", async () => {
      const notifications = [Notification.create("guild1", userId, "keyword")];
      mockNotificationService.findMatchingNotifications.mockResolvedValue(
        notifications,
      );

      const settings: UserNotificationSettings = {
        ignoreUnjoinedThreads: true,
      };
      mockNotificationService.getUserSettingsMap.mockResolvedValue(
        new Map([[userId, settings]]),
      );

      const { mockMessage, memberSend } = makeThreadMessage(false);

      await service.processMessage(mockMessage as unknown as Message);

      expect(memberSend).not.toHaveBeenCalled();
    });

    test("public thread + ignoreUnjoinedThreads: false → notification sent regardless of thread membership", async () => {
      const notifications = [Notification.create("guild1", userId, "keyword")];
      mockNotificationService.findMatchingNotifications.mockResolvedValue(
        notifications,
      );

      const settings: UserNotificationSettings = {
        ignoreUnjoinedThreads: false,
      };
      mockNotificationService.getUserSettingsMap.mockResolvedValue(
        new Map([[userId, settings]]),
      );

      // User is NOT a thread member, but ignoreUnjoinedThreads is false so they
      // should still receive the notification.
      const { mockMessage, memberSend } = makeThreadMessage(false);

      await service.processMessage(mockMessage as unknown as Message);

      expect(memberSend).toHaveBeenCalled();
    });
  });
});
