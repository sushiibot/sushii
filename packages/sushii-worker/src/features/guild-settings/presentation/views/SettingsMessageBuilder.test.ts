import { describe, expect, test } from "bun:test";

import { GuildConfig } from "@/shared/domain/entities/GuildConfig";

import type { SettingsPage } from "./components/SettingsConstants";
import { createSettingsMessage } from "./SettingsMessageBuilder";

const DISCORD_MAX_COMPONENTS = 40;

/**
 * Recursively count all components in a component tree, including nested
 * children and accessories (e.g. button accessory on Section).
 */
function countComponents(component: Record<string, unknown>): number {
  let count = 1;

  if (Array.isArray(component.components)) {
    for (const child of component.components as Record<string, unknown>[]) {
      count += countComponents(child);
    }
  }

  if (component.accessory && typeof component.accessory === "object") {
    count += countComponents(component.accessory as Record<string, unknown>);
  }

  return count;
}

function totalComponentCount(
  message: ReturnType<typeof createSettingsMessage>,
): number {
  let total = 0;
  for (const topLevel of message.components) {
    total += countComponents(topLevel.toJSON() as unknown as Record<string, unknown>);
  }
  return total;
}

const defaultConfig = GuildConfig.createDefault("123456789");

// Config with all toggles enabled and all DM texts set (maximises component text length,
// which doesn't affect count but ensures we're testing the worst-case content).
const allEnabledConfig = new GuildConfig(
  "123456789",
  "!",
  {
    joinMessage: "Welcome <mention> to <server>!",
    joinMessageEnabled: true,
    leaveMessage: "<mention> has left <server>.",
    leaveMessageEnabled: true,
    messageChannel: "111111111111111111",
  },
  {
    modLogChannel: "222222222222222222",
    modLogEnabled: true,
    memberLogChannel: "333333333333333333",
    memberLogEnabled: true,
    messageLogChannel: "444444444444444444",
    messageLogEnabled: true,
    reactionLogChannel: "555555555555555555",
    reactionLogEnabled: true,
  },
  {
    timeoutDmText: "You have been timed out. Appeal at #appeals.",
    timeoutCommandDmEnabled: true,
    timeoutNativeDmEnabled: true,
    warnDmText: "Please review our rules.",
    banDmText: "You have been banned. Appeal at https://appeals.example.com",
    banDmEnabled: true,
    kickDmText: "You have been kicked.",
    kickDmEnabled: true,
    lookupDetailsOptIn: true,
    lookupPrompted: true,
    automodSpamEnabled: true,
  },
  [],
);

const pages: SettingsPage[] = [
  "logging",
  "moderation",
  "automod",
  "messages",
  "advanced",
];

describe("SettingsMessageBuilder component limits", () => {
  describe("default config", () => {
    for (const page of pages) {
      test(`${page} page stays within ${DISCORD_MAX_COMPONENTS} components`, () => {
        const message = createSettingsMessage({ page, config: defaultConfig });
        const count = totalComponentCount(message);
        expect(count).toBeLessThanOrEqual(DISCORD_MAX_COMPONENTS);
      });
    }
  });

  describe("all settings enabled with DM texts set", () => {
    for (const page of pages) {
      test(`${page} page stays within ${DISCORD_MAX_COMPONENTS} components`, () => {
        const message = createSettingsMessage({
          page,
          config: allEnabledConfig,
        });
        const count = totalComponentCount(message);
        expect(count).toBeLessThanOrEqual(DISCORD_MAX_COMPONENTS);
      });
    }
  });
});
