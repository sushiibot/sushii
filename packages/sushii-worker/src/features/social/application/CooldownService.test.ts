import { describe, it, expect, beforeEach } from "bun:test";
import dayjs from "@/shared/domain/dayjs";
import { UserProfile } from "@/features/user-profile";
import { CooldownService } from "./CooldownService";
import { SOCIAL_COOLDOWN_HOURS } from "../domain";

describe("CooldownService", () => {
  let cooldownService: CooldownService;

  beforeEach(() => {
    cooldownService = new CooldownService();
  });

  describe("checkFishyCooldown", () => {
    it("should return null when user has never fished", () => {
      const user = UserProfile.createDefault("123");
      const result = cooldownService.checkFishyCooldown(user);
      expect(result).toBeNull();
    });

    it("should return null when cooldown has expired", () => {
      const pastTime = dayjs.utc().subtract(SOCIAL_COOLDOWN_HOURS + 1, "hours").toDate();
      const user = UserProfile.create({
        id: "123",
        rep: BigInt(0),
        fishies: BigInt(0),
        isPatron: false,
        lastFishies: pastTime,
        lastRep: null,
        lastfmUsername: null,
        patronEmoji: null,
        profileData: {},
      });

      const result = cooldownService.checkFishyCooldown(user);
      expect(result).toBeNull();
    });

    it("should return future time when user is on cooldown", () => {
      const recentTime = dayjs.utc().subtract(6, "hours").toDate(); // 6 hours ago, still on cooldown
      const user = UserProfile.create({
        id: "123",
        rep: BigInt(0),
        fishies: BigInt(0),
        isPatron: false,
        lastFishies: recentTime,
        lastRep: null,
        lastfmUsername: null,
        patronEmoji: null,
        profileData: {},
      });

      const result = cooldownService.checkFishyCooldown(user);
      expect(result).not.toBeNull();
      expect(result?.isAfter(dayjs.utc())).toBe(true);
    });
  });

  describe("checkRepCooldown", () => {
    it("should return null when user has never given rep", () => {
      const user = UserProfile.createDefault("123");
      const result = cooldownService.checkRepCooldown(user);
      expect(result).toBeNull();
    });

    it("should return null when cooldown has expired", () => {
      const pastTime = dayjs.utc().subtract(SOCIAL_COOLDOWN_HOURS + 1, "hours").toDate();
      const user = UserProfile.create({
        id: "123",
        rep: BigInt(0),
        fishies: BigInt(0),
        isPatron: false,
        lastFishies: null,
        lastRep: pastTime,
        lastfmUsername: null,
        patronEmoji: null,
        profileData: {},
      });

      const result = cooldownService.checkRepCooldown(user);
      expect(result).toBeNull();
    });

    it("should return future time when user is on cooldown", () => {
      const recentTime = dayjs.utc().subtract(6, "hours").toDate(); // 6 hours ago, still on cooldown
      const user = UserProfile.create({
        id: "123",
        rep: BigInt(0),
        fishies: BigInt(0),
        isPatron: false,
        lastFishies: null,
        lastRep: recentTime,
        lastfmUsername: null,
        patronEmoji: null,
        profileData: {},
      });

      const result = cooldownService.checkRepCooldown(user);
      expect(result).not.toBeNull();
      expect(result?.isAfter(dayjs.utc())).toBe(true);
    });
  });
});