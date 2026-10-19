import { describe, expect, test } from "bun:test";
import type { GuildMember } from "discord.js";

import {
  MAX_MESSAGE_LENGTH,
  MessageTemplateService,
} from "./MessageTemplateService";

function createMember(
  overrides: {
    username?: string;
    guildName?: string;
    memberCount?: number;
  } = {},
): GuildMember {
  const id = "111111111111111111";
  return {
    id,
    user: {
      id,
      username: overrides.username ?? "alice",
      toString: () => `<@${id}>`,
    },
    guild: {
      name: overrides.guildName ?? "Cool Server",
      memberCount: overrides.memberCount ?? 42,
    },
  } as unknown as GuildMember;
}

describe("MessageTemplateService", () => {
  const service = new MessageTemplateService();

  describe("replaceTemplate", () => {
    test("replaces all placeholders", () => {
      const result = service.replaceTemplate(
        "Welcome <mention> (<username>) to <server>! You are #<member_number>. Hi <username>",
        createMember(),
      );

      expect(result).toBe(
        "Welcome <@111111111111111111> (alice) to Cool Server! You are #42. Hi alice",
      );
    });

    test("does not interpret replacement patterns in names", () => {
      const result = service.replaceTemplate(
        "Hi <username>, welcome to <server>",
        createMember({ username: "a$&b$1$$c$`d$'", guildName: "$& srv $$" }),
      );

      expect(result).toBe("Hi a$&b$1$$c$`d$', welcome to $& srv $$");
    });

    test("does not re-substitute placeholders contained in names", () => {
      const result = service.replaceTemplate(
        "<server> / <username>",
        createMember({ guildName: "<username>", username: "bob" }),
      );

      expect(result).toBe("<username> / bob");
    });
  });

  describe("buildMessage", () => {
    test("truncates content longer than the Discord limit", () => {
      const result = service.buildMessage(
        `${"x".repeat(2100)} <mention>`,
        createMember(),
      );

      expect(result.content.length).toBe(MAX_MESSAGE_LENGTH);
      expect(result.content.endsWith("…")).toBe(true);
    });

    test("leaves short content untouched", () => {
      const result = service.buildMessage("Hi <mention>", createMember());

      expect(result.content).toBe("Hi <@111111111111111111>");
    });

    test("allows only the joining member mention by default", () => {
      const result = service.buildMessage(
        "Hi <mention> from <server>",
        createMember({ guildName: "@everyone <@&222222222222222222>" }),
      );

      expect(result.allowedMentions).toEqual({
        parse: [],
        users: ["111111111111111111"],
        roles: [],
      });
    });

    test("allows mentions written directly in the template by admins", () => {
      const result = service.buildMessage(
        "@everyone <@&222222222222222222> <@!333333333333333333> welcome <mention>",
        createMember(),
      );

      expect(result.allowedMentions).toEqual({
        parse: ["everyone"],
        users: ["111111111111111111", "333333333333333333"],
        roles: ["222222222222222222"],
      });
    });

    test("does not allow @everyone injected via username", () => {
      const result = service.buildMessage(
        "Welcome <username>",
        createMember({ username: "@here" }),
      );

      expect(result.allowedMentions.parse).toEqual([]);
    });
  });
});
