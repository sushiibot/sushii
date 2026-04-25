import { beforeEach, describe, expect, test } from "bun:test";

import { SoftbanSuppressionSet } from "./SoftbanSuppressionSet";

describe("SoftbanSuppressionSet", () => {
  let set: SoftbanSuppressionSet;

  beforeEach(() => {
    set = new SoftbanSuppressionSet();
  });

  test("suppress marks a guildId:userId pair as suppressed", () => {
    set.suppress("guild-1", "user-1");
    expect(set.isSuppressed("guild-1", "user-1")).toBe(true);
  });

  test("isSuppressed returns false for unknown entries", () => {
    expect(set.isSuppressed("guild-1", "user-1")).toBe(false);
  });

  test("isSuppressed is scoped to guildId — different guilds do not interfere", () => {
    set.suppress("guild-1", "user-1");
    expect(set.isSuppressed("guild-2", "user-1")).toBe(false);
  });

  test("isSuppressed is scoped to userId — different users do not interfere", () => {
    set.suppress("guild-1", "user-1");
    expect(set.isSuppressed("guild-1", "user-2")).toBe(false);
  });

  test("release removes a suppressed entry immediately", () => {
    set.suppress("guild-1", "user-1");
    expect(set.isSuppressed("guild-1", "user-1")).toBe(true);
    set.release("guild-1", "user-1");
    expect(set.isSuppressed("guild-1", "user-1")).toBe(false);
  });

  test("release on an unknown entry is a no-op", () => {
    // Should not throw
    expect(() => set.release("guild-1", "user-1")).not.toThrow();
  });

  test("multiple suppress calls reset the TTL (entry stays suppressed)", () => {
    set.suppress("guild-1", "user-1");
    set.suppress("guild-1", "user-1");
    expect(set.isSuppressed("guild-1", "user-1")).toBe(true);
    set.release("guild-1", "user-1");
  });

  test("suppress and release of multiple independent entries", () => {
    set.suppress("guild-1", "user-1");
    set.suppress("guild-1", "user-2");
    set.suppress("guild-2", "user-1");

    expect(set.isSuppressed("guild-1", "user-1")).toBe(true);
    expect(set.isSuppressed("guild-1", "user-2")).toBe(true);
    expect(set.isSuppressed("guild-2", "user-1")).toBe(true);

    set.release("guild-1", "user-1");

    expect(set.isSuppressed("guild-1", "user-1")).toBe(false);
    expect(set.isSuppressed("guild-1", "user-2")).toBe(true);
    expect(set.isSuppressed("guild-2", "user-1")).toBe(true);

    set.release("guild-1", "user-2");
    set.release("guild-2", "user-1");
  });
});
