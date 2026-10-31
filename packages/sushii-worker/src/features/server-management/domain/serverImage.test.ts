import { describe, expect, test } from "bun:test";
import { GuildFeature } from "discord.js";

import { MAX_SERVER_IMAGE_BYTES, checkServerImage } from "./serverImage";

function file(contentType: string | null, size = 50_000) {
  return { contentType, size };
}

describe("checkServerImage", () => {
  test("accepts a static icon on any server", () => {
    expect(checkServerImage("icon", file("image/png"), [])).toBeNull();
  });

  test("ignores content type parameters and case", () => {
    expect(
      checkServerImage("icon", file("IMAGE/JPEG; charset=binary"), []),
    ).toBeNull();
  });

  test("rejects non-image and missing content types", () => {
    expect(checkServerImage("icon", file("application/pdf"), [])).toBe(
      "not_image",
    );
    expect(checkServerImage("icon", file("image/svg+xml"), [])).toBe(
      "not_image",
    );
    expect(checkServerImage("icon", file(null), [])).toBe("not_image");
  });

  test("rejects files over the upload limit", () => {
    expect(
      checkServerImage(
        "icon",
        file("image/png", MAX_SERVER_IMAGE_BYTES + 1),
        [],
      ),
    ).toBe("too_large");
    expect(
      checkServerImage("icon", file("image/png", MAX_SERVER_IMAGE_BYTES), []),
    ).toBeNull();
  });

  test("rejects a banner when the server hasn't unlocked banners", () => {
    expect(checkServerImage("banner", file("image/png"), [])).toBe(
      "banner_locked",
    );
    expect(
      checkServerImage("banner", file("image/png"), [GuildFeature.Banner]),
    ).toBeNull();
  });

  test("rejects a gif icon without the animated icon perk", () => {
    expect(checkServerImage("icon", file("image/gif"), [])).toBe(
      "animated_locked",
    );
    expect(
      checkServerImage("icon", file("image/gif"), [GuildFeature.AnimatedIcon]),
    ).toBeNull();
  });

  test("checks the animated banner perk, not the animated icon one", () => {
    expect(
      checkServerImage("banner", file("image/gif"), [
        GuildFeature.Banner,
        GuildFeature.AnimatedIcon,
      ]),
    ).toBe("animated_locked");
    expect(
      checkServerImage("banner", file("image/gif"), [
        GuildFeature.Banner,
        GuildFeature.AnimatedBanner,
      ]),
    ).toBeNull();
  });
});
