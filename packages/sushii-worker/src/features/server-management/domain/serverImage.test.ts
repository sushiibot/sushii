import { describe, expect, test } from "bun:test";
import { GuildFeature } from "discord.js";

import { checkServerImage } from "./serverImage";

describe("checkServerImage", () => {
  test("leaves format and size to Discord", () => {
    expect(checkServerImage("icon", "image/png", [])).toBeNull();
    expect(checkServerImage("icon", "image/webp", [])).toBeNull();
    expect(checkServerImage("icon", "application/pdf", [])).toBeNull();
    expect(checkServerImage("icon", null, [])).toBeNull();
  });

  test("rejects a banner when the server hasn't unlocked banners", () => {
    expect(checkServerImage("banner", "image/png", [])).toBe("banner_locked");
    expect(
      checkServerImage("banner", "image/png", [GuildFeature.Banner]),
    ).toBeNull();
  });

  test("rejects a gif icon without the animated icon perk", () => {
    expect(checkServerImage("icon", "image/gif", [])).toBe("animated_locked");
    expect(checkServerImage("icon", "IMAGE/GIF; x=y", [])).toBe(
      "animated_locked",
    );
    expect(
      checkServerImage("icon", "image/gif", [GuildFeature.AnimatedIcon]),
    ).toBeNull();
  });

  test("checks the animated banner perk, not the animated icon one", () => {
    expect(
      checkServerImage("banner", "image/gif", [
        GuildFeature.Banner,
        GuildFeature.AnimatedIcon,
      ]),
    ).toBe("animated_locked");
    expect(
      checkServerImage("banner", "image/gif", [
        GuildFeature.Banner,
        GuildFeature.AnimatedBanner,
      ]),
    ).toBeNull();
  });
});
