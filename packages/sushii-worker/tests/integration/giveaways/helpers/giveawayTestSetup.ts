import dayjs from "@/shared/domain/dayjs";
import type { GiveawayData } from "@/features/giveaways/domain/entities/Giveaway";

/**
 * Simple test utilities for giveaway integration tests
 */

export function createBasicGiveawayData(overrides: Partial<GiveawayData> = {}): GiveawayData {
  const now = dayjs.utc();
  
  return {
    id: "123456789012345678",
    channelId: "100000000000000001", 
    guildId: "100000000000000000",
    hostUserId: "100000000000000002",
    numWinners: 1,
    prize: "Test Prize",
    requiredRoleId: undefined,
    requiredMinLevel: undefined,
    requiredMaxLevel: undefined,
    requiredBoosting: undefined,
    startAt: now.toDate(),
    endAt: now.add(1, 'hour').toDate(),
    isEnded: false,
    ...overrides,
  };
}

export function createGiveawayDataWithLevelRequirement(
  minLevel: number,
  overrides: Partial<GiveawayData> = {}
): GiveawayData {
  return createBasicGiveawayData({
    requiredMinLevel: minLevel,
    prize: `Level ${minLevel}+ Required Prize`,
    ...overrides,
  });
}