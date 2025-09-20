import { describe, expect, test } from "bun:test";

import { UserProfile } from "../domain/entities/UserProfile";

describe("UserProfile entity", () => {
  test("creates default profile", () => {
    const userId = "123456789";
    const profile = UserProfile.createDefault(userId);

    expect(profile.getId()).toBe(userId);
    expect(profile.getRep()).toBe(BigInt(0));
    expect(profile.getFishies()).toBe(BigInt(0));
    expect(profile.getIsPatron()).toBe(false);
    expect(profile.getLastFishies()).toBe(null);
    expect(profile.getLastRep()).toBe(null);
    expect(profile.getLastfmUsername()).toBe(null);
    expect(profile.getPatronEmoji()).toBe(null);
    expect(profile.getProfileData()).toEqual({});
  });

  test("updates rep", () => {
    const profile = UserProfile.createDefault("123456789");
    const newRep = BigInt(100);

    const updatedProfile = profile.updateRep(newRep);

    expect(updatedProfile.getRep()).toBe(newRep);
    expect(updatedProfile.getLastRep()).toBeNull(); // Does not set last rep for recipient

    expect(profile.getRep()).toBe(BigInt(0)); // Original unchanged
  });

  test("updates fishies", () => {
    const profile = UserProfile.createDefault("123456789");
    const newFishies = BigInt(50);

    const updatedProfile = profile.updateFishies(newFishies);

    expect(updatedProfile.getFishies()).toBe(newFishies);
    expect(updatedProfile.getLastFishies()).toBeNull(); // Does not set last fishy for recipient

    expect(profile.getFishies()).toBe(BigInt(0)); // Original unchanged
  });

  test("updates patron status", () => {
    const profile = UserProfile.createDefault("123456789");

    const updatedProfile = profile.updatePatronStatus(true, "🔥");

    expect(updatedProfile.getIsPatron()).toBe(true);
    expect(updatedProfile.getPatronEmoji()).toBe("🔥");
  });

  test("serializes to data correctly", () => {
    const data = {
      id: "123456789",
      rep: BigInt(100),
      fishies: BigInt(50),
      isPatron: true,
      lastFishies: new Date("2023-01-01"),
      lastRep: new Date("2023-01-02"),
      lastfmUsername: "testuser",
      patronEmoji: "🔥",
      profileData: { patron_cents: 100 },
    };

    const profile = UserProfile.create(data);
    const serialized = profile.toData();

    expect(serialized).toEqual(data);
  });
});
