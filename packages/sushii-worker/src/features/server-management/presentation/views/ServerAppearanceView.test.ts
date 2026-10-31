import { describe, expect, test } from "bun:test";
import type { APIMessageTopLevelComponent } from "discord.js";
import { ComponentType, MessageFlags } from "discord.js";

import { fallbackMention } from "@/shared/presentation/commandMentions";

import {
  buildServerAppearanceErrorReply,
  buildServerImageChangedMessage,
  buildServerNameRestoredMessage,
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

describe("name messages", () => {
  const snapshot = {
    guildId: "111111111111111111",
    name: "TWICE *Fans*",
    savedBy: MOD_ID,
    savedAt: new Date("2026-10-29T00:00:00Z"),
  };

  test("renamed message escapes names and points to restore-name", () => {
    const content = text(
      buildServerRenamedMessage(
        { previousName: "TWICE *Fans*", snapshot },
        "TWICE Fans 🎂 Nayeon",
        MOD_ID,
        fallbackMention,
      ).components,
    );

    expect(content).toContain("TWICE \\\\*Fans\\\\*");
    expect(content).toContain("`/server restore-name` changes it back");
  });

  test("restored message credits who saved the name", () => {
    const content = text(
      buildServerNameRestoredMessage(
        { previousName: "TWICE Fans 🎂 Nayeon", snapshot },
        MOD_ID,
      ).components,
    );

    expect(content).toContain(`by <@${MOD_ID}>`);
    expect(content).toContain("<t:1793232000:R>");
  });
});

describe("errors", () => {
  test("are ephemeral", () => {
    const reply = buildServerAppearanceErrorReply("nope");
    expect(reply.flags).toBe(
      MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    );
  });

  test("name the boost level for the right image kind", () => {
    expect(
      describeServerAppearanceError("animated_locked", "icon", fallbackMention),
    ).toContain("boost level 1");
    expect(
      describeServerAppearanceError(
        "animated_locked",
        "banner",
        fallbackMention,
      ),
    ).toContain("boost level 3");
  });
});
