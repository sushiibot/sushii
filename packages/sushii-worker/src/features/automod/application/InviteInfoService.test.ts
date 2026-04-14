import { describe, expect, test } from "bun:test";

import { InviteInfoService } from "./InviteInfoService";

// Only testing extractInviteCodes — fetchInviteInfo/fetchInviteInfos require
// a live Discord client and are exercised in integration tests.
const service = new InviteInfoService(null as never, null as never);

describe("InviteInfoService.extractInviteCodes", () => {
  describe("discord.gg short links", () => {
    test("bare discord.gg/CODE", () => {
      expect(service.extractInviteCodes("discord.gg/invitecodehere")).toEqual([
        "invitecodehere",
      ]);
    });

    test("https://discord.gg/CODE", () => {
      expect(
        service.extractInviteCodes("https://discord.gg/invitecode"),
      ).toEqual(["invitecode"]);
    });

    test("http://discord.gg/CODE", () => {
      expect(
        service.extractInviteCodes("http://discord.gg/invitecode"),
      ).toEqual(["invitecode"]);
    });

    test("www.discord.gg/CODE", () => {
      expect(
        service.extractInviteCodes("https://www.discord.gg/invitecode"),
      ).toEqual(["invitecode"]);
    });
  });

  describe("discord.com/invite links", () => {
    test("https://discord.com/invite/CODE", () => {
      expect(
        service.extractInviteCodes("https://discord.com/invite/invitecodere"),
      ).toEqual(["invitecodere"]);
    });

    test("http://discord.com/invite/CODE", () => {
      expect(
        service.extractInviteCodes("http://discord.com/invite/invitecodere"),
      ).toEqual(["invitecodere"]);
    });

    test("bare discord.com/invite/CODE (no scheme)", () => {
      expect(
        service.extractInviteCodes("discord.com/invite/invitecodere"),
      ).toEqual(["invitecodere"]);
    });
  });

  describe("discordapp.com/invite links", () => {
    test("https://discordapp.com/invite/CODE", () => {
      expect(
        service.extractInviteCodes("https://discordapp.com/invite/abc123"),
      ).toEqual(["abc123"]);
    });
  });

  describe("codes with hyphens", () => {
    test("hyphenated invite code", () => {
      expect(
        service.extractInviteCodes("discord.gg/my-cool-server"),
      ).toEqual(["my-cool-server"]);
    });
  });

  describe("multiple links in one message", () => {
    test("two different links", () => {
      const codes = service.extractInviteCodes(
        "join discord.gg/abc and also https://discord.com/invite/xyz",
      );
      expect(codes).toHaveLength(2);
      expect(codes).toContain("abc");
      expect(codes).toContain("xyz");
    });

    test("deduplicates identical codes", () => {
      const codes = service.extractInviteCodes(
        "discord.gg/abc discord.gg/abc https://discord.gg/abc",
      );
      expect(codes).toEqual(["abc"]);
    });
  });

  describe("no links", () => {
    test("empty string returns empty array", () => {
      expect(service.extractInviteCodes("")).toEqual([]);
    });

    test("plain text returns empty array", () => {
      expect(service.extractInviteCodes("hello world")).toEqual([]);
    });

    test("unrelated URL returns empty array", () => {
      expect(
        service.extractInviteCodes("https://example.com/invite/abc"),
      ).toEqual([]);
    });
  });

  describe("links embedded in surrounding text", () => {
    test("link inside a sentence", () => {
      expect(
        service.extractInviteCodes(
          "Come join us at https://discord.gg/coolserver today!",
        ),
      ).toEqual(["coolserver"]);
    });
  });
});
