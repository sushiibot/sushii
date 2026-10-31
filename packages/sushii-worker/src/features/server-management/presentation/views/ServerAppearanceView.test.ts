import { describe, expect, test } from "bun:test";
import type { APIMessageTopLevelComponent } from "discord.js";
import { ComponentType, MessageFlags } from "discord.js";

import { fallbackMention } from "@/shared/presentation/commandMentions";

import {
  buildServerAppearanceErrorReply,
  buildServerImageChangedMessage,
  buildServerRenamedMessage,
  describeServerAppearanceError,
} from "./ServerAppearanceView";

const MOD_ID = "222222222222222222";
const PREVIOUS = {
  url: "https://cdn/icons/old.png",
  file: { data: Buffer.from([1]), filename: "previous-icon.png" },
};

function json(
  components: readonly unknown[] | undefined,
): APIMessageTopLevelComponent[] {
  return (components ?? []).map((c) =>
    (c as { toJSON(): APIMessageTopLevelComponent }).toJSON(),
  );
}

function text(components: readonly unknown[] | undefined): string {
  return JSON.stringify(json(components));
}

describe("buildServerImageChangedMessage", () => {
  test("shows the attached previous icon as Before and hints how to switch back", () => {
    const message = buildServerImageChangedMessage(
      "icon",
      { previous: PREVIOUS, currentUrl: "https://cdn/icons/new.png" },
      MOD_ID,
      fallbackMention,
    );

    expect(message.files).toHaveLength(1);
    expect(message.flags).toBe(MessageFlags.IsComponentsV2);
    const content = text(message.components);
    expect(content).toContain("attachment://previous-icon.png");
    expect(content).toContain("https://cdn/icons/new.png");
    expect(content).toContain("upload it with `/server icon`");
  });

  test("links the previous image when it was too large to attach", () => {
    const message = buildServerImageChangedMessage(
      "icon",
      {
        previous: { url: "https://cdn/icons/old.png", file: null },
        currentUrl: "https://cdn/icons/new.png",
      },
      MOD_ID,
      fallbackMention,
    );

    expect(message.files).toEqual([]);
    const content = text(message.components);
    expect(content).toContain("https://cdn/icons/old.png");
    expect(content).toContain("switch back");
  });

  test("says there was no icon and skips the hint when nothing was replaced", () => {
    const message = buildServerImageChangedMessage(
      "icon",
      { previous: null, currentUrl: "https://cdn/icons/new.png" },
      MOD_ID,
      fallbackMention,
    );

    expect(message.files).toEqual([]);
    const content = text(message.components);
    expect(content).toContain("**Before:** no icon");
    expect(content).not.toContain("switch back");
  });

  test("uses media galleries for banners", () => {
    const message = buildServerImageChangedMessage(
      "banner",
      {
        previous: {
          url: "https://cdn/banners/old.png",
          file: { data: Buffer.from([1]), filename: "previous-banner.png" },
        },
        currentUrl: "https://cdn/banners/new.png",
      },
      MOD_ID,
      fallbackMention,
    );

    const [container] = json(message.components);
    const types =
      container.type === ComponentType.Container
        ? container.components.map((c) => c.type)
        : [];
    expect(types.filter((t) => t === ComponentType.MediaGallery)).toHaveLength(
      2,
    );
    expect(message.flags).not.toBe(
      MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    );
  });
});

describe("buildServerRenamedMessage", () => {
  test("shows both names with markdown escaped", () => {
    const content = text(
      buildServerRenamedMessage("TWICE *Fans*", "TWICE Fans 🎂 Nayeon", MOD_ID)
        .components,
    );

    expect(content).toContain("TWICE \\\\*Fans\\\\*");
    expect(content).toContain("TWICE Fans 🎂 Nayeon");
  });
});

describe("errors", () => {
  test("are ephemeral", () => {
    const reply = buildServerAppearanceErrorReply("nope");
    expect(reply.flags).toBe(
      MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    );
  });

  test("too large states Discord's limit when Discord gave one", () => {
    const text = describeServerAppearanceError("too_large", {
      target: "banner",
      fileSize: 14.2 * 1024 * 1024,
      limitBytes: 10240 * 1024,
      mention: fallbackMention,
    });

    expect(text).toBe(
      "That image is 14.2 MB, and Discord's limit for a server banner is 10.0 MB. Resize it to about 960×540 or save it as a JPG and run `/server banner` again.",
    );
  });

  test("too large without a stated limit doesn't invent one", () => {
    const text = describeServerAppearanceError("too_large", {
      target: "icon",
      fileSize: 9.8 * 1024 * 1024,
      limitBytes: null,
      mention: fallbackMention,
    });

    expect(text).toBe(
      "Discord says that image is too large for a server icon. Resize it to about 1024×1024 or save it as a JPG and run `/server icon` again.",
    );
  });

  test("every image error ends with a next step", () => {
    for (const error of ["invalid_image", "animated_locked"] as const) {
      expect(
        describeServerAppearanceError(error, {
          target: "icon",
          mention: fallbackMention,
        }),
      ).toEndWith("and run `/server icon` again.");
    }
  });

  test("name the boost level for the right image kind", () => {
    const icon = describeServerAppearanceError("animated_locked", {
      target: "icon",
      mention: fallbackMention,
    });
    const banner = describeServerAppearanceError("animated_locked", {
      target: "banner",
      mention: fallbackMention,
    });

    expect(icon).toContain("boost level 1");
    expect(banner).toContain("boost level 3");
  });
});
