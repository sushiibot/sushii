import { describe, expect, test } from "bun:test";
import type { GuildMember, User } from "discord.js";
import { PermissionFlagsBits, PermissionsBitField } from "discord.js";

import { ActionType } from "../../domain/value-objects/ActionType";
import { DiscordPermissionValidationService } from "./DiscordPermissionValidationService";

const executor = { id: "100000000000000001" } as User;
const target = { id: "100000000000000002" } as User;

function memberWith(...flags: bigint[]): GuildMember {
  return {
    permissions: new PermissionsBitField(flags),
    guild: { ownerId: "100000000000000099" },
  } as unknown as GuildMember;
}

describe("DiscordPermissionValidationService", () => {
  const service = new DiscordPermissionValidationService();

  describe("canTargetUser with a non-member target", () => {
    test("rejects ban without Ban Members", async () => {
      const result = await service.canTargetUser(
        executor,
        memberWith(PermissionFlagsBits.KickMembers),
        target,
        null,
        ActionType.Ban,
      );

      expect(result.err).toBe(true);
    });

    test("rejects unban without Ban Members", async () => {
      const result = await service.canTargetUser(
        executor,
        memberWith(),
        target,
        null,
        ActionType.BanRemove,
      );

      expect(result.err).toBe(true);
    });

    test("allows ban with Ban Members", async () => {
      const result = await service.canTargetUser(
        executor,
        memberWith(PermissionFlagsBits.BanMembers),
        target,
        null,
        ActionType.Ban,
      );

      expect(result.ok).toBe(true);
    });

    test("allows note without extra permissions", async () => {
      const result = await service.canTargetUser(
        executor,
        memberWith(),
        target,
        null,
        ActionType.Note,
      );

      expect(result.ok).toBe(true);
    });
  });
});
