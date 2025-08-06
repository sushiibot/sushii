import { describe, expect, test } from "bun:test";
import { User } from "discord.js";

import { PruneOptions } from "./PruneOptions";

function createMockUser(id: string = "123456789012345678"): User {
  return {
    id,
    tag: "TestUser#1234",
  } as User;
}

describe("PruneOptions", () => {
  describe("creation success cases", () => {
    test("should create with valid max delete count", () => {
      const result = PruneOptions.create(2, null, null, null, null, null, null);
      expect(result.ok).toBe(true);
      expect(result.unwrap().maxDeleteCount).toBe(2);

      const result100 = PruneOptions.create(
        100,
        null,
        null,
        null,
        null,
        null,
        null,
      );
      expect(result100.ok).toBe(true);
      expect(result100.unwrap().maxDeleteCount).toBe(100);

      const result50 = PruneOptions.create(
        50,
        null,
        null,
        null,
        null,
        null,
        null,
      );
      expect(result50.ok).toBe(true);
      expect(result50.unwrap().maxDeleteCount).toBe(50);
    });

    test("should create with valid plain message IDs", () => {
      const validMessageId = "123456789012345678";
      const result = PruneOptions.create(
        10,
        validMessageId,
        null,
        null,
        null,
        null,
        null,
      );

      expect(result.ok).toBe(true);
      const options = result.unwrap();
      expect(options.afterMessageID).toBe(validMessageId);
      expect(options.beforeMessageID).toBe(null);
    });

    test("should create with valid Discord URL message IDs", () => {
      const discordUrl =
        "https://discord.com/channels/123456789012345678/987654321098765432/111222333444555666";
      const result = PruneOptions.create(
        10,
        discordUrl,
        null,
        null,
        null,
        null,
        null,
      );

      expect(result.ok).toBe(true);
      expect(result.unwrap().afterMessageID).toBe("111222333444555666");
    });

    test("should create with both after and before message IDs when after < before", () => {
      const afterId = "123456789012345678";
      const beforeId = "987654321098765432";
      const result = PruneOptions.create(
        10,
        afterId,
        beforeId,
        null,
        null,
        null,
        null,
      );

      expect(result.ok).toBe(true);
      expect(result.unwrap().afterMessageID).toBe(afterId);
      expect(result.unwrap().beforeMessageID).toBe(beforeId);
    });

    test("should create with user and other optional parameters", () => {
      const mockUser = createMockUser();
      const result = PruneOptions.create(
        10,
        null,
        null,
        mockUser,
        true,
        "has_attachments",
        "bots_only",
      );

      expect(result.ok).toBe(true);
      expect(result.unwrap().user).toBe(mockUser);
      expect(result.unwrap().skipPinned).toBe(true);
      expect(result.unwrap().attachments).toBe("has_attachments");
      expect(result.unwrap().botsOrUsers).toBe("bots_only");
    });

    test("should handle null optional parameters", () => {
      const result = PruneOptions.create(
        10,
        null,
        null,
        null,
        null,
        null,
        null,
      );

      expect(result.ok).toBe(true);
      expect(result.unwrap().afterMessageID).toBe(null);
      expect(result.unwrap().beforeMessageID).toBe(null);
      expect(result.unwrap().user).toBe(null);
      expect(result.unwrap().skipPinned).toBe(null);
      expect(result.unwrap().attachments).toBe(null);
      expect(result.unwrap().botsOrUsers).toBe(null);
    });
  });

  describe("creation validation failures", () => {
    test("should fail with max delete count below 2", () => {
      const result = PruneOptions.create(1, null, null, null, null, null, null);
      expect(result.ok).toBe(false);
      expect(result.val).toBe("Max delete count must be between 2 and 100");
    });

    test("should fail with max delete count above 100", () => {
      const result = PruneOptions.create(
        101,
        null,
        null,
        null,
        null,
        null,
        null,
      );
      expect(result.ok).toBe(false);
      expect(result.val).toBe("Max delete count must be between 2 and 100");
    });

    test("should fail with invalid after message ID format", () => {
      const invalidId = "invalid_message_id";
      const result = PruneOptions.create(
        10,
        invalidId,
        null,
        null,
        null,
        null,
        null,
      );

      expect(result.ok).toBe(false);
      expect(result.val).toBe("Invalid after message ID format");
    });

    test("should fail with invalid before message ID format", () => {
      const invalidId = "12345"; // Too short
      const result = PruneOptions.create(
        10,
        null,
        invalidId,
        null,
        null,
        null,
        null,
      );

      expect(result.ok).toBe(false);
      expect(result.val).toBe("Invalid before message ID format");
    });

    test("should fail when after message ID is newer than before message ID", () => {
      const afterId = "987654321098765432"; // Larger ID (newer)
      const beforeId = "123456789012345678"; // Smaller ID (older)
      const result = PruneOptions.create(
        10,
        afterId,
        beforeId,
        null,
        null,
        null,
        null,
      );

      expect(result.ok).toBe(false);
      expect(result.val).toBe(
        "After message ID must be older than before message ID",
      );
    });

    test("should fail with message ID too short", () => {
      const shortId = "1234567890123456"; // 16 digits, minimum is 17
      const result = PruneOptions.create(
        10,
        shortId,
        null,
        null,
        null,
        null,
        null,
      );

      expect(result.ok).toBe(false);
      expect(result.val).toBe("Invalid after message ID format");
    });

    test("should fail with message ID too long", () => {
      const longId = "1234567890123456789012"; // 22 digits, maximum is 21
      const result = PruneOptions.create(
        10,
        longId,
        null,
        null,
        null,
        null,
        null,
      );

      expect(result.ok).toBe(false);
      expect(result.val).toBe("Invalid after message ID format");
    });
  });

  describe("message ID parsing", () => {
    test("should parse valid plain message IDs", () => {
      const validIds = [
        "12345678901234567", // 17 digits
        "123456789012345678", // 18 digits
        "1234567890123456789", // 19 digits
        "12345678901234567890", // 20 digits
        "123456789012345678901", // 21 digits
      ];

      for (const id of validIds) {
        const result = PruneOptions.create(
          10,
          id,
          null,
          null,
          null,
          null,
          null,
        );
        expect(result.ok).toBe(true);
        expect(result.unwrap().afterMessageID).toBe(id);
      }
    });

    test("should parse message ID from Discord URLs", () => {
      const testCases = [
        {
          url: "https://discord.com/channels/123456789012345678/987654321098765432/111222333444555666",
          expectedId: "111222333444555666",
        },
        {
          url: "discord.com/channels/123456789012345678/987654321098765432/111222333444555666",
          expectedId: "111222333444555666",
        },
      ];

      for (const testCase of testCases) {
        const result = PruneOptions.create(
          10,
          testCase.url,
          null,
          null,
          null,
          null,
          null,
        );
        expect(result.ok).toBe(true);
        expect(result.unwrap().afterMessageID).toBe(testCase.expectedId);
      }
    });

    test("should fail with invalid Discord URLs", () => {
      const invalidUrls = [
        "https://discord.com/channels/123/456/789", // IDs too short
        "https://discord.com/channels/invalid/url/format",
        "https://google.com/some/other/url",
        "not-a-url-at-all",
      ];

      for (const url of invalidUrls) {
        const result = PruneOptions.create(
          10,
          url,
          null,
          null,
          null,
          null,
          null,
        );
        expect(result.ok).toBe(false);
      }
    });

    test("should handle empty and whitespace strings", () => {
      const emptyResult = PruneOptions.create(
        10,
        "",
        null,
        null,
        null,
        null,
        null,
      );
      expect(emptyResult.ok).toBe(true);
      expect(emptyResult.unwrap().afterMessageID).toBe(null);

      const whitespaceResult = PruneOptions.create(
        10,
        "   ",
        null,
        null,
        null,
        null,
        null,
      );
      expect(whitespaceResult.ok).toBe(false);
      expect(whitespaceResult.val).toBe("Invalid after message ID format");
    });
  });

  describe("property getters", () => {
    test("should return correct values for all properties", () => {
      const mockUser = createMockUser();
      const result = PruneOptions.create(
        25,
        "123456789012345678",
        "987654321098765432",
        mockUser,
        true,
        "has_attachments",
        "users_only",
      );

      expect(result.ok).toBe(true);
      const options = result.unwrap();

      expect(options.maxDeleteCount).toBe(25);
      expect(options.afterMessageID).toBe("123456789012345678");
      expect(options.beforeMessageID).toBe("987654321098765432");
      expect(options.user).toBe(mockUser);
      expect(options.skipPinned).toBe(true);
      expect(options.attachments).toBe("has_attachments");
      expect(options.botsOrUsers).toBe("users_only");
    });

    test("should return null for unset optional properties", () => {
      const result = PruneOptions.create(
        10,
        null,
        null,
        null,
        null,
        null,
        null,
      );
      expect(result.ok).toBe(true);
      const options = result.unwrap();

      expect(options.afterMessageID).toBe(null);
      expect(options.beforeMessageID).toBe(null);
      expect(options.user).toBe(null);
      expect(options.skipPinned).toBe(null);
      expect(options.attachments).toBe(null);
      expect(options.botsOrUsers).toBe(null);
    });
  });

  describe("getFetchOptions method", () => {
    test("should return correct fetch options with after ID only", () => {
      const afterId = "123456789012345678";
      const result = PruneOptions.create(
        10,
        afterId,
        null,
        null,
        null,
        null,
        null,
      );
      expect(result.ok).toBe(true);

      const fetchOptions = result.unwrap().getFetchOptions();

      expect(fetchOptions.limit).toBe(100);
      expect(fetchOptions.after).toBe(afterId);
      expect(fetchOptions.before).toBeUndefined();
    });

    test("should return correct fetch options with before ID only", () => {
      const beforeId = "987654321098765432";
      const result = PruneOptions.create(
        10,
        null,
        beforeId,
        null,
        null,
        null,
        null,
      );
      expect(result.ok).toBe(true);

      const fetchOptions = result.unwrap().getFetchOptions();

      expect(fetchOptions.limit).toBe(100);
      expect(fetchOptions.after).toBeUndefined();
      expect(fetchOptions.before).toBe(beforeId);
    });

    test("should prioritize after over before when both are provided", () => {
      const afterId = "123456789012345678";
      const beforeId = "987654321098765432";
      const result = PruneOptions.create(
        10,
        afterId,
        beforeId,
        null,
        null,
        null,
        null,
      );
      expect(result.ok).toBe(true);

      const fetchOptions = result.unwrap().getFetchOptions();

      expect(fetchOptions.limit).toBe(100);
      expect(fetchOptions.after).toBe(afterId);
      expect(fetchOptions.before).toBeUndefined();
    });

    test("should return correct fetch options with no message IDs", () => {
      const result = PruneOptions.create(
        10,
        null,
        null,
        null,
        null,
        null,
        null,
      );
      expect(result.ok).toBe(true);

      const fetchOptions = result.unwrap().getFetchOptions();

      expect(fetchOptions.limit).toBe(100);
      expect(fetchOptions.after).toBeUndefined();
      expect(fetchOptions.before).toBeUndefined();
    });

    test("should always set limit to 100 regardless of maxDeleteCount", () => {
      const result2 = PruneOptions.create(
        2,
        null,
        null,
        null,
        null,
        null,
        null,
      );
      expect(result2.ok).toBe(true);
      expect(result2.unwrap().getFetchOptions().limit).toBe(100);

      const result100 = PruneOptions.create(
        100,
        null,
        null,
        null,
        null,
        null,
        null,
      );
      expect(result100.ok).toBe(true);
      expect(result100.unwrap().getFetchOptions().limit).toBe(100);
    });
  });
});
