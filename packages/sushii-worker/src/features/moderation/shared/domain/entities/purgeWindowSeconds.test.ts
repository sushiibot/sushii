import { describe, expect, test } from "bun:test";
import type { User } from "discord.js";

import {
  BanAction,
  SoftbanAction,
  WarnAction,
  purgeWindowSeconds,
} from "./ModerationAction";

const GUILD = "100000000000000001";
const executor = { id: "200000000000000001" } as User;

describe("purgeWindowSeconds", () => {
  test("bans report the window Discord is asked to delete", () => {
    expect(
      purgeWindowSeconds(
        new BanAction(GUILD, executor, null, null, "unspecified", null, 1),
      ),
    ).toBe(86_400);
    expect(
      purgeWindowSeconds(
        new BanAction(
          GUILD,
          executor,
          null,
          null,
          "unspecified",
          null,
          undefined,
          3600,
        ),
      ),
    ).toBe(3600);
    expect(
      purgeWindowSeconds(
        new BanAction(GUILD, executor, null, null, "unspecified"),
      ),
    ).toBe(0);
  });

  test("softbans keep their own window", () => {
    expect(
      purgeWindowSeconds(
        new SoftbanAction(GUILD, executor, null, null, "unspecified", 3600),
      ),
    ).toBe(3600);
  });

  test("actions that never delete messages have no window", () => {
    expect(
      purgeWindowSeconds(
        new WarnAction(GUILD, executor, null, null, "unspecified"),
      ),
    ).toBeNull();
  });
});
