import { describe, expect, test } from "bun:test";
import type { Attachment, Message, User } from "discord.js";
import { Collection } from "discord.js";

import {
  MessageFilter,
  PruneAttachmentsOption,
  PruneBotsOrUsersOption,
} from "./MessageFilter";

// Mock factories using bun mock()
function createMockUser(
  options: {
    id?: string;
    bot?: boolean;
  } = {},
): User {
  return {
    id: options.id ?? "123456789012345678",
    bot: options.bot ?? false,
  } as User;
}

function createMockMessage(
  options: {
    id?: string;
    author?: User;
    pinned?: boolean;
    attachments?: Collection<string, Attachment>;
  } = {},
): Message {
  const attachments =
    options.attachments ?? new Collection<string, Attachment>();

  return {
    id: options.id ?? "123456789012345678",
    author: options.author ?? createMockUser(),
    pinned: options.pinned ?? false,
    attachments,
  } as Message;
}

function createMockAttachment(id: string = "attachment123") {
  return {
    id,
    name: "test.png",
    size: 1024,
  } as Attachment;
}

describe("MessageFilter", () => {
  describe("constructor and factory", () => {
    test("should create MessageFilter with static factory method", () => {
      const criteria = {
        beforeMessageID: null,
        afterMessageID: null,
        user: null,
        maxDeleteCount: 10,
        skipPinned: null,
        attachments: null,
        botsOrUsers: null,
      };

      const filter = MessageFilter.create(criteria);
      expect(filter).toBeInstanceOf(MessageFilter);
    });

    test("should create MessageFilter with constructor", () => {
      const criteria = {
        beforeMessageID: "987654321098765432",
        afterMessageID: "123456789012345678",
        user: createMockUser(),
        maxDeleteCount: 50,
        skipPinned: true,
        attachments: PruneAttachmentsOption.WithAttachments,
        botsOrUsers: PruneBotsOrUsersOption.BotsOnly,
      };

      const filter = new MessageFilter(criteria);
      expect(filter).toBeInstanceOf(MessageFilter);
    });
  });

  describe("property getters", () => {
    test("should return correct beforeMessageID", () => {
      const beforeId = "987654321098765432";
      const filter = MessageFilter.create({
        beforeMessageID: beforeId,
        afterMessageID: null,
        user: null,
        maxDeleteCount: null,
        skipPinned: null,
        attachments: null,
        botsOrUsers: null,
      });

      expect(filter.beforeMessageID).toBe(beforeId);
    });

    test("should return correct afterMessageID", () => {
      const afterId = "123456789012345678";
      const filter = MessageFilter.create({
        beforeMessageID: null,
        afterMessageID: afterId,
        user: null,
        maxDeleteCount: null,
        skipPinned: null,
        attachments: null,
        botsOrUsers: null,
      });

      expect(filter.afterMessageID).toBe(afterId);
    });

    test("should return null for unset message IDs", () => {
      const filter = MessageFilter.create({
        beforeMessageID: null,
        afterMessageID: null,
        user: null,
        maxDeleteCount: null,
        skipPinned: null,
        attachments: null,
        botsOrUsers: null,
      });

      expect(filter.beforeMessageID).toBe(null);
      expect(filter.afterMessageID).toBe(null);
    });
  });

  describe("filter method - user filtering", () => {
    test("should filter messages by specific user", () => {
      const targetUser = createMockUser({ id: "target123" });
      const otherUser = createMockUser({ id: "other456" });

      const messages = [
        createMockMessage({ id: "1", author: targetUser }),
        createMockMessage({ id: "2", author: otherUser }),
        createMockMessage({ id: "3", author: targetUser }),
      ];

      const filter = MessageFilter.create({
        beforeMessageID: null,
        afterMessageID: null,
        user: targetUser,
        maxDeleteCount: null,
        skipPinned: null,
        attachments: null,
        botsOrUsers: null,
      });

      const result = filter.filter(messages);
      expect(result.filteredMessages).toHaveLength(2);
      expect(result.filteredMessages[0].author.id).toBe("target123");
      expect(result.filteredMessages[1].author.id).toBe("target123");
    });

    test("should include all messages when user is null", () => {
      const user1 = createMockUser({ id: "user1" });
      const user2 = createMockUser({ id: "user2" });

      const messages = [
        createMockMessage({ id: "1", author: user1 }),
        createMockMessage({ id: "2", author: user2 }),
      ];

      const filter = MessageFilter.create({
        beforeMessageID: null,
        afterMessageID: null,
        user: null,
        maxDeleteCount: null,
        skipPinned: null,
        attachments: null,
        botsOrUsers: null,
      });

      const result = filter.filter(messages);
      expect(result.filteredMessages).toHaveLength(2);
    });
  });

  describe("filter method - pinned message filtering", () => {
    test("should skip pinned messages when skipPinned is true", () => {
      const messages = [
        createMockMessage({ id: "1", pinned: false }),
        createMockMessage({ id: "2", pinned: true }),
        createMockMessage({ id: "3", pinned: false }),
      ];

      const filter = MessageFilter.create({
        beforeMessageID: null,
        afterMessageID: null,
        user: null,
        maxDeleteCount: null,
        skipPinned: true,
        attachments: null,
        botsOrUsers: null,
      });

      const result = filter.filter(messages);
      expect(result.filteredMessages).toHaveLength(2);
      expect(result.filteredMessages.every((msg) => !msg.pinned)).toBe(true);
    });

    test("should include pinned messages when skipPinned is false", () => {
      const messages = [
        createMockMessage({ id: "1", pinned: false }),
        createMockMessage({ id: "2", pinned: true }),
      ];

      const filter = MessageFilter.create({
        beforeMessageID: null,
        afterMessageID: null,
        user: null,
        maxDeleteCount: null,
        skipPinned: false,
        attachments: null,
        botsOrUsers: null,
      });

      const result = filter.filter(messages);
      expect(result.filteredMessages).toHaveLength(2);
    });

    test("should include all messages when skipPinned is null", () => {
      const messages = [
        createMockMessage({ id: "1", pinned: false }),
        createMockMessage({ id: "2", pinned: true }),
      ];

      const filter = MessageFilter.create({
        beforeMessageID: null,
        afterMessageID: null,
        user: null,
        maxDeleteCount: null,
        skipPinned: null,
        attachments: null,
        botsOrUsers: null,
      });

      const result = filter.filter(messages);
      expect(result.filteredMessages).toHaveLength(2);
    });
  });

  describe("filter method - attachment filtering", () => {
    test("should filter messages with attachments when WithAttachments is specified", () => {
      const attachments = new Collection<string, Attachment>();
      attachments.set("1", createMockAttachment("1"));

      const messages = [
        createMockMessage({
          id: "1",
          attachments: new Collection<string, Attachment>(),
        }),
        createMockMessage({ id: "2", attachments }),
        createMockMessage({
          id: "3",
          attachments: new Collection<string, Attachment>(),
        }),
      ];

      const filter = MessageFilter.create({
        beforeMessageID: null,
        afterMessageID: null,
        user: null,
        maxDeleteCount: null,
        skipPinned: null,
        attachments: PruneAttachmentsOption.WithAttachments,
        botsOrUsers: null,
      });

      const result = filter.filter(messages);
      expect(result.filteredMessages).toHaveLength(1);
      expect(result.filteredMessages[0].id).toBe("2");
    });

    test("should filter messages without attachments when WithoutAttachments is specified", () => {
      const attachments = new Collection<string, Attachment>();
      attachments.set("1", createMockAttachment("1"));

      const messages = [
        createMockMessage({
          id: "1",
          attachments: new Collection<string, Attachment>(),
        }),
        createMockMessage({ id: "2", attachments }),
        createMockMessage({
          id: "3",
          attachments: new Collection<string, Attachment>(),
        }),
      ];

      const filter = MessageFilter.create({
        beforeMessageID: null,
        afterMessageID: null,
        user: null,
        maxDeleteCount: null,
        skipPinned: null,
        attachments: PruneAttachmentsOption.WithoutAttachments,
        botsOrUsers: null,
      });

      const result = filter.filter(messages);
      expect(result.filteredMessages).toHaveLength(2);
      expect(result.filteredMessages[0].id).toBe("1");
      expect(result.filteredMessages[1].id).toBe("3");
    });

    test("should include all messages when attachments filter is null", () => {
      const attachments = new Collection<string, Attachment>();
      attachments.set("1", createMockAttachment("1"));

      const messages = [
        createMockMessage({
          id: "1",
          attachments: new Collection<string, Attachment>(),
        }),
        createMockMessage({ id: "2", attachments }),
      ];

      const filter = MessageFilter.create({
        beforeMessageID: null,
        afterMessageID: null,
        user: null,
        maxDeleteCount: null,
        skipPinned: null,
        attachments: null,
        botsOrUsers: null,
      });

      const result = filter.filter(messages);
      expect(result.filteredMessages).toHaveLength(2);
    });
  });

  describe("filter method - bot/user filtering", () => {
    test("should filter only bot messages when BotsOnly is specified", () => {
      const botUser = createMockUser({ id: "bot1", bot: true });
      const humanUser = createMockUser({ id: "human1", bot: false });

      const messages = [
        createMockMessage({ id: "1", author: botUser }),
        createMockMessage({ id: "2", author: humanUser }),
        createMockMessage({ id: "3", author: botUser }),
      ];

      const filter = MessageFilter.create({
        beforeMessageID: null,
        afterMessageID: null,
        user: null,
        maxDeleteCount: null,
        skipPinned: null,
        attachments: null,
        botsOrUsers: PruneBotsOrUsersOption.BotsOnly,
      });

      const result = filter.filter(messages);
      expect(result.filteredMessages).toHaveLength(2);
      expect(result.filteredMessages.every((msg) => msg.author.bot)).toBe(true);
    });

    test("should filter only user messages when UsersOnly is specified", () => {
      const botUser = createMockUser({ id: "bot1", bot: true });
      const humanUser = createMockUser({ id: "human1", bot: false });

      const messages = [
        createMockMessage({ id: "1", author: botUser }),
        createMockMessage({ id: "2", author: humanUser }),
        createMockMessage({ id: "3", author: humanUser }),
      ];

      const filter = MessageFilter.create({
        beforeMessageID: null,
        afterMessageID: null,
        user: null,
        maxDeleteCount: null,
        skipPinned: null,
        attachments: null,
        botsOrUsers: PruneBotsOrUsersOption.UsersOnly,
      });

      const result = filter.filter(messages);
      expect(result.filteredMessages).toHaveLength(2);
      expect(result.filteredMessages.every((msg) => !msg.author.bot)).toBe(
        true,
      );
    });

    test("should include all messages when botsOrUsers filter is null", () => {
      const botUser = createMockUser({ id: "bot1", bot: true });
      const humanUser = createMockUser({ id: "human1", bot: false });

      const messages = [
        createMockMessage({ id: "1", author: botUser }),
        createMockMessage({ id: "2", author: humanUser }),
      ];

      const filter = MessageFilter.create({
        beforeMessageID: null,
        afterMessageID: null,
        user: null,
        maxDeleteCount: null,
        skipPinned: null,
        attachments: null,
        botsOrUsers: null,
      });

      const result = filter.filter(messages);
      expect(result.filteredMessages).toHaveLength(2);
    });
  });

  describe("filter method - message ID range filtering", () => {
    test("should filter messages older than beforeMessageID", () => {
      const messages = [
        createMockMessage({ id: "100" }), // Older (smaller ID)
        createMockMessage({ id: "200" }), // Should be excluded (equal or newer)
        createMockMessage({ id: "300" }), // Should be excluded (newer)
      ];

      const filter = MessageFilter.create({
        beforeMessageID: "200",
        afterMessageID: null,
        user: null,
        maxDeleteCount: null,
        skipPinned: null,
        attachments: null,
        botsOrUsers: null,
      });

      const result = filter.filter(messages);
      expect(result.filteredMessages).toHaveLength(1);
      expect(result.filteredMessages[0].id).toBe("100");
    });

    test("should filter messages newer than afterMessageID", () => {
      const messages = [
        createMockMessage({ id: "100" }), // Should be excluded (equal or older)
        createMockMessage({ id: "200" }), // Newer (larger ID)
        createMockMessage({ id: "300" }), // Newer (larger ID)
      ];

      const filter = MessageFilter.create({
        beforeMessageID: null,
        afterMessageID: "100",
        user: null,
        maxDeleteCount: null,
        skipPinned: null,
        attachments: null,
        botsOrUsers: null,
      });

      const result = filter.filter(messages);
      expect(result.filteredMessages).toHaveLength(2);
      expect(result.filteredMessages[0].id).toBe("200");
      expect(result.filteredMessages[1].id).toBe("300");
    });

    test("should filter messages between afterMessageID and beforeMessageID", () => {
      const messages = [
        createMockMessage({ id: "50" }), // Too old
        createMockMessage({ id: "100" }), // Boundary (excluded)
        createMockMessage({ id: "150" }), // In range
        createMockMessage({ id: "200" }), // Boundary (excluded)
        createMockMessage({ id: "250" }), // Too new
      ];

      const filter = MessageFilter.create({
        beforeMessageID: "200",
        afterMessageID: "100",
        user: null,
        maxDeleteCount: null,
        skipPinned: null,
        attachments: null,
        botsOrUsers: null,
      });

      const result = filter.filter(messages);
      expect(result.filteredMessages).toHaveLength(1);
      expect(result.filteredMessages[0].id).toBe("150");
    });

    test("should handle large message IDs with BigInt conversion", () => {
      const messages = [
        createMockMessage({ id: "123456789012345678" }),
        createMockMessage({ id: "987654321098765432" }),
      ];

      const filter = MessageFilter.create({
        beforeMessageID: "987654321098765432",
        afterMessageID: null,
        user: null,
        maxDeleteCount: null,
        skipPinned: null,
        attachments: null,
        botsOrUsers: null,
      });

      const result = filter.filter(messages);
      expect(result.filteredMessages).toHaveLength(1);
      expect(result.filteredMessages[0].id).toBe("123456789012345678");
    });
  });

  describe("filter method - maxDeleteCount limiting", () => {
    test("should limit results to maxDeleteCount", () => {
      const messages = Array.from({ length: 10 }, (_, i) =>
        createMockMessage({ id: `${i + 1}` }),
      );

      const filter = MessageFilter.create({
        beforeMessageID: null,
        afterMessageID: null,
        user: null,
        maxDeleteCount: 5,
        skipPinned: null,
        attachments: null,
        botsOrUsers: null,
      });

      const result = filter.filter(messages);
      expect(result.filteredMessages).toHaveLength(5);
    });

    test("should default to 100 when maxDeleteCount is null", () => {
      const messages = Array.from({ length: 150 }, (_, i) =>
        createMockMessage({ id: `${i + 1}` }),
      );

      const filter = MessageFilter.create({
        beforeMessageID: null,
        afterMessageID: null,
        user: null,
        maxDeleteCount: null,
        skipPinned: null,
        attachments: null,
        botsOrUsers: null,
      });

      const result = filter.filter(messages);
      expect(result.filteredMessages).toHaveLength(100);
    });

    test("should not limit when filtered messages are fewer than maxDeleteCount", () => {
      const messages = [
        createMockMessage({ id: "1" }),
        createMockMessage({ id: "2" }),
      ];

      const filter = MessageFilter.create({
        beforeMessageID: null,
        afterMessageID: null,
        user: null,
        maxDeleteCount: 10,
        skipPinned: null,
        attachments: null,
        botsOrUsers: null,
      });

      const result = filter.filter(messages);
      expect(result.filteredMessages).toHaveLength(2);
    });
  });

  describe("filter method - userDeletedSummary", () => {
    test("should count messages per user correctly", () => {
      const user1 = createMockUser({ id: "user1" });
      const user2 = createMockUser({ id: "user2" });

      const messages = [
        createMockMessage({ id: "1", author: user1 }),
        createMockMessage({ id: "2", author: user1 }),
        createMockMessage({ id: "3", author: user2 }),
        createMockMessage({ id: "4", author: user1 }),
      ];

      const filter = MessageFilter.create({
        beforeMessageID: null,
        afterMessageID: null,
        user: null,
        maxDeleteCount: null,
        skipPinned: null,
        attachments: null,
        botsOrUsers: null,
      });

      const result = filter.filter(messages);
      expect(result.userDeletedSummary).toEqual({
        user1: 3,
        user2: 1,
      });
    });

    test("should return empty summary for no messages", () => {
      const filter = MessageFilter.create({
        beforeMessageID: null,
        afterMessageID: null,
        user: null,
        maxDeleteCount: null,
        skipPinned: null,
        attachments: null,
        botsOrUsers: null,
      });

      const result = filter.filter([]);
      expect(result.userDeletedSummary).toEqual({});
      expect(result.filteredMessages).toHaveLength(0);
    });

    test("should count only filtered messages in summary", () => {
      const user1 = createMockUser({ id: "user1" });
      const user2 = createMockUser({ id: "user2" });

      const messages = [
        createMockMessage({ id: "1", author: user1, pinned: false }),
        createMockMessage({ id: "2", author: user1, pinned: true }), // Will be filtered out
        createMockMessage({ id: "3", author: user2, pinned: false }),
      ];

      const filter = MessageFilter.create({
        beforeMessageID: null,
        afterMessageID: null,
        user: null,
        maxDeleteCount: null,
        skipPinned: true,
        attachments: null,
        botsOrUsers: null,
      });

      const result = filter.filter(messages);
      expect(result.userDeletedSummary).toEqual({
        user1: 1,
        user2: 1,
      });
      expect(result.filteredMessages).toHaveLength(2);
    });
  });

  describe("filter method - combined filters", () => {
    test("should apply multiple filters correctly", () => {
      const targetUser = createMockUser({ id: "target", bot: false });
      const botUser = createMockUser({ id: "bot", bot: true });

      const attachments = new Collection<string, Attachment>();
      attachments.set("1", createMockAttachment("1"));

      const messages = [
        createMockMessage({
          id: "100",
          author: targetUser,
          pinned: false,
          attachments: new Collection(),
        }),
        createMockMessage({
          id: "200",
          author: targetUser,
          pinned: true,
          attachments: new Collection(),
        }), // Filtered out (pinned)
        createMockMessage({
          id: "300",
          author: botUser,
          pinned: false,
          attachments: new Collection(),
        }), // Filtered out (bot)
        createMockMessage({
          id: "400",
          author: targetUser,
          pinned: false,
          attachments,
        }), // Filtered out (has attachments)
        createMockMessage({
          id: "500",
          author: targetUser,
          pinned: false,
          attachments: new Collection(),
        }),
      ];

      const filter = MessageFilter.create({
        beforeMessageID: null,
        afterMessageID: null,
        user: targetUser,
        maxDeleteCount: null,
        skipPinned: true,
        attachments: PruneAttachmentsOption.WithoutAttachments,
        botsOrUsers: PruneBotsOrUsersOption.UsersOnly,
      });

      const result = filter.filter(messages);
      expect(result.filteredMessages).toHaveLength(2);
      expect(result.filteredMessages[0].id).toBe("100");
      expect(result.filteredMessages[1].id).toBe("500");
      expect(result.userDeletedSummary).toEqual({
        target: 2,
      });
    });
  });

  describe("filter method - edge cases", () => {
    test("should handle empty message array", () => {
      const filter = MessageFilter.create({
        beforeMessageID: null,
        afterMessageID: null,
        user: null,
        maxDeleteCount: null,
        skipPinned: null,
        attachments: null,
        botsOrUsers: null,
      });

      const result = filter.filter([]);
      expect(result.filteredMessages).toHaveLength(0);
      expect(result.userDeletedSummary).toEqual({});
    });

    test("should handle all messages being filtered out", () => {
      const messages = [
        createMockMessage({ id: "1", pinned: true }),
        createMockMessage({ id: "2", pinned: true }),
      ];

      const filter = MessageFilter.create({
        beforeMessageID: null,
        afterMessageID: null,
        user: null,
        maxDeleteCount: null,
        skipPinned: true,
        attachments: null,
        botsOrUsers: null,
      });

      const result = filter.filter(messages);
      expect(result.filteredMessages).toHaveLength(0);
      expect(result.userDeletedSummary).toEqual({});
    });
  });
});
