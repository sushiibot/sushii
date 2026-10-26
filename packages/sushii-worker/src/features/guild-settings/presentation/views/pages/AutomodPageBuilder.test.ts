import { describe, expect, test } from "bun:test";
import { ContainerBuilder } from "discord.js";

import type { EmojiMap } from "@/features/bot-emojis/domain";
import type { ScreeningSettingsState } from "@/features/member-screening/application/ScreeningSettingsPort";
import { GuildConfig } from "@/shared/domain/entities/GuildConfig";

import type { ChannelPermissionsMap } from "../../utils/PermissionChecker";
import type { SettingsMessageOptions } from "../components/SettingsConstants";
import {
  SETTINGS_CUSTOM_IDS,
  SETTINGS_EMOJI_NAMES,
} from "../components/SettingsConstants";
import { addAutomodContent } from "./AutomodPageBuilder";

interface ComponentJson {
  type: number;
  content?: string;
  custom_id?: string;
  label?: string;
  style?: number;
  disabled?: boolean;
  channel_types?: number[];
  min_values?: number;
  max_values?: number;
  default_values?: { id: string; type: string }[];
  components?: ComponentJson[];
  accessory?: ComponentJson;
}

const mockEmojis = Object.fromEntries(
  SETTINGS_EMOJI_NAMES.map((name) => [name, `<:${name}:000000000000000000>`]),
) as EmojiMap<typeof SETTINGS_EMOJI_NAMES>;

const config = GuildConfig.createDefault("123456789");
const LOG_CHANNEL_ID = "1029384756102938400";

// Top-level component types of the automod page before member screening existed.
const BASE_AUTOMOD_TYPES = [10, 10, 1, 14, 9, 14, 9, 14, 10, 1];

function render(
  overrides: Partial<SettingsMessageOptions> = {},
): ComponentJson[] {
  const container = new ContainerBuilder();
  addAutomodContent(container, {
    page: "automod",
    config,
    emojis: mockEmojis,
    ...overrides,
  });
  return (container.toJSON() as unknown as { components: ComponentJson[] })
    .components;
}

function screeningComponents(components: ComponentJson[]): ComponentJson[] {
  const start = components.findIndex(
    (c) => c.accessory?.custom_id === SETTINGS_CUSTOM_IDS.SCREENING.TOGGLE,
  );
  expect(start).toBeGreaterThan(-1);
  return components.slice(start, start + 5);
}

function allCustomIds(components: ComponentJson[]): string[] {
  return components.flatMap((c) => [
    ...(c.custom_id ? [c.custom_id] : []),
    ...(c.accessory?.custom_id ? [c.accessory.custom_id] : []),
    ...allCustomIds(c.components ?? []),
  ]);
}

describe("addAutomodContent member screening section", () => {
  test("is absent when the flag is off", () => {
    const withoutKey = render();

    expect(withoutKey.map((c) => c.type)).toEqual(BASE_AUTOMOD_TYPES);
    expect(render({ screening: null })).toEqual(withoutKey);
    expect(render({ screening: undefined })).toEqual(withoutKey);

    const ids = allCustomIds(withoutKey);
    expect(ids).not.toContain(SETTINGS_CUSTOM_IDS.SCREENING.TOGGLE);
    expect(ids).not.toContain(SETTINGS_CUSTOM_IDS.SCREENING.TOGGLE_AVATARS);
    expect(ids).not.toContain(SETTINGS_CUSTOM_IDS.SCREENING.SET_CHANNEL);
  });

  test("sits between Spam Detection and Exempt Roles", () => {
    const components = render({
      screening: { enabled: false, logChannelId: null, checkAvatars: true },
    });

    expect(components.map((c) => c.type)).toEqual([
      10, 10, 1, 14, 9, 14, 9, 14, 9, 10, 1, 9, 14, 10, 1,
    ]);
    expect(components[6].accessory?.custom_id).toBe(
      SETTINGS_CUSTOM_IDS.TOGGLES.AUTOMOD_SPAM,
    );
    expect(components[13].content).toStartWith("### Exempt Roles");
  });

  test("shows Off when screening is off", () => {
    const [toggle, label, row, avatars] = screeningComponents(
      render({
        screening: { enabled: false, logChannelId: null, checkAvatars: true },
      }),
    );

    expect(toggle.components?.[0].content).toBe(
      "### 🔍 Member Screening\nChecks new members' messages, avatars and image links with AI during their first 20 messages or 72 hours, and posts suspicious ones for review.\n-# Off",
    );
    expect(toggle.accessory?.label).toBe("Enable");
    expect(label.content).toBe(
      "**Log channel**\nWhere flagged members are posted for review.",
    );

    const select = row.components?.[0];
    expect(select?.custom_id).toBe(SETTINGS_CUSTOM_IDS.SCREENING.SET_CHANNEL);
    expect(select?.channel_types).toEqual([0, 5]);
    expect(select?.min_values).toBe(0);
    expect(select?.max_values).toBe(1);
    expect(select?.default_values ?? []).toEqual([]);

    expect(avatars.components?.[0].content).toBe(
      "### Check profile pictures\nAlso check new members' avatars.",
    );
    expect(avatars.accessory?.custom_id).toBe(
      SETTINGS_CUSTOM_IDS.SCREENING.TOGGLE_AVATARS,
    );
    expect(avatars.accessory?.label).toBe("Disable");
  });

  test("asks for a log channel when on without one", () => {
    const [toggle] = screeningComponents(
      render({
        screening: { enabled: true, logChannelId: null, checkAvatars: true },
      }),
    );

    expect(toggle.components?.[0].content).toEndWith(
      "\n-# ⚠️ Pick a log channel to start screening",
    );
    expect(toggle.accessory?.label).toBe("Disable");
  });

  test("shows the log channel when on with one", () => {
    const [toggle, label, row] = screeningComponents(
      render({
        screening: {
          enabled: true,
          logChannelId: LOG_CHANNEL_ID,
          checkAvatars: true,
        },
      }),
    );

    expect(toggle.components?.[0].content).toEndWith(
      `\n-# ✅ On · posting to <#${LOG_CHANNEL_ID}>`,
    );
    expect(label.content).not.toContain("Missing permissions");
    expect(row.components?.[0].default_values).toEqual([
      { id: LOG_CHANNEL_ID, type: "channel" },
    ]);
  });

  test("warns about missing permissions on the log channel", () => {
    const channelPermissions: ChannelPermissionsMap = {
      [LOG_CHANNEL_ID]: {
        channelId: LOG_CHANNEL_ID,
        hasViewChannel: true,
        hasSendMessages: false,
        hasEmbedLinks: true,
        missingPermissions: ["Send Messages"],
      },
    };
    const [, label] = screeningComponents(
      render({
        screening: {
          enabled: true,
          logChannelId: LOG_CHANNEL_ID,
          checkAvatars: true,
        },
        channelPermissions,
      }),
    );

    expect(label.content).toEndWith(
      "\n⚠️ **Missing permissions:** Send Messages",
    );
  });

  test("offers to enable avatar checks when they are off", () => {
    const [, , , avatars] = screeningComponents(
      render({
        screening: {
          enabled: true,
          logChannelId: LOG_CHANNEL_ID,
          checkAvatars: false,
        },
      }),
    );

    expect(avatars.accessory?.label).toBe("Enable");
  });

  test("disables every screening input when expired", () => {
    const state: ScreeningSettingsState = {
      enabled: true,
      logChannelId: LOG_CHANNEL_ID,
      checkAvatars: true,
    };
    const [toggle, , row, avatars] = screeningComponents(
      render({ screening: state, disabled: true }),
    );

    expect(toggle.accessory?.disabled).toBe(true);
    expect(row.components?.[0].disabled).toBe(true);
    expect(avatars.accessory?.disabled).toBe(true);
  });
});
