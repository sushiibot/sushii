import { describe, expect, mock, test } from "bun:test";
import type {
  AutocompleteFocusedOption,
  AutocompleteInteraction,
} from "discord.js";

import { findFocusedOption } from "./InteractionRouter";

// Mock factories for Discord.js types
const createMockFocusedOption = (
  name: string = "option",
  value: string = "test_value",
): AutocompleteFocusedOption => ({
  name,
  value,
  type: 3, // STRING type
  focused: true,
});

const createMockOptions = (
  subGroup?: string,
  subCommand?: string,
  focusedOption: AutocompleteFocusedOption = createMockFocusedOption(),
) => ({
  getSubcommandGroup: mock(() => subGroup || null),
  getSubcommand: mock((required?: boolean) => {
    if (required === false) return subCommand || null;
    if (subCommand) return subCommand;
    if (required) throw new Error("No subcommand");
    return subCommand || null;
  }),
  getFocused: mock(() => focusedOption),
});

const createMockInteraction = (
  commandName: string = "test",
  subGroup?: string,
  subCommand?: string,
  focusedOption?: AutocompleteFocusedOption,
): AutocompleteInteraction =>
  ({
    commandName,
    options: createMockOptions(subGroup, subCommand, focusedOption),
  }) as unknown as AutocompleteInteraction;

describe("findFocusedOption", () => {
  describe("basic command structure", () => {
    test("should handle simple command with no subcommands", () => {
      const focusedOption = createMockFocusedOption("name", "test");
      const interaction = createMockInteraction(
        "tag",
        undefined,
        undefined,
        focusedOption,
      );

      const result = findFocusedOption(interaction);

      expect(result).toEqual({
        path: "tag",
        option: focusedOption,
      });
    });

    test("should handle command with subcommand", () => {
      const focusedOption = createMockFocusedOption("name", "my-tag");
      const interaction = createMockInteraction(
        "tag",
        undefined,
        "get",
        focusedOption,
      );

      const result = findFocusedOption(interaction);

      expect(result).toEqual({
        path: "tag.get",
        option: focusedOption,
      });
    });

    test("should handle command with subcommand group and subcommand", () => {
      const focusedOption = createMockFocusedOption("type", "user");
      const interaction = createMockInteraction(
        "notification",
        "config",
        "delete",
        focusedOption,
      );

      const result = findFocusedOption(interaction);

      expect(result).toEqual({
        path: "notification.config.delete",
        option: focusedOption,
      });
    });
  });

  describe("subcommand group handling", () => {
    test("should include subcommand group in path when present", () => {
      const focusedOption = createMockFocusedOption("channel", "123456");
      const interaction = createMockInteraction(
        "moderation",
        "ban",
        "add",
        focusedOption,
      );

      const result = findFocusedOption(interaction);

      expect(result).toEqual({
        path: "moderation.ban.add",
        option: focusedOption,
      });
    });

    test("should handle subcommand group without subcommand", () => {
      const focusedOption = createMockFocusedOption("setting", "enabled");
      const interaction = createMockInteraction(
        "config",
        "general",
        undefined,
        focusedOption,
      );

      const result = findFocusedOption(interaction);

      expect(result).toEqual({
        path: "config.general",
        option: focusedOption,
      });
    });
  });

  describe("focused option types", () => {
    test("should handle string focused option", () => {
      const focusedOption = createMockFocusedOption("query", "search term");
      const interaction = createMockInteraction(
        "search",
        undefined,
        undefined,
        focusedOption,
      );

      const result = findFocusedOption(interaction);

      expect(result?.option.name).toBe("query");
      expect(result?.option.value).toBe("search term");
    });

    test("should handle number-like focused option", () => {
      const focusedOption = createMockFocusedOption("amount", "100");
      const interaction = createMockInteraction(
        "give",
        undefined,
        "coins",
        focusedOption,
      );

      const result = findFocusedOption(interaction);

      expect(result?.option.name).toBe("amount");
      expect(result?.option.value).toBe("100");
    });

    test("should handle empty string focused option", () => {
      const focusedOption = createMockFocusedOption("name", "");
      const interaction = createMockInteraction(
        "tag",
        undefined,
        "create",
        focusedOption,
      );

      const result = findFocusedOption(interaction);

      expect(result?.option.value).toBe("");
    });
  });

  describe("path building", () => {
    test("should join path components with dots", () => {
      const focusedOption = createMockFocusedOption("target", "user");
      const interaction = createMockInteraction(
        "admin",
        "user",
        "ban",
        focusedOption,
      );

      const result = findFocusedOption(interaction);

      expect(result?.path).toBe("admin.user.ban");
    });

    test("should handle complex command names", () => {
      const focusedOption = createMockFocusedOption("option", "value");
      const interaction = createMockInteraction(
        "complex-command",
        "sub-group",
        "sub-command",
        focusedOption,
      );

      const result = findFocusedOption(interaction);

      expect(result?.path).toBe("complex-command.sub-group.sub-command");
    });
  });

  describe("Discord.js integration", () => {
    test("should call getSubcommandGroup correctly", () => {
      const interaction = createMockInteraction("test");
      findFocusedOption(interaction);

      expect(interaction.options.getSubcommandGroup).toHaveBeenCalled();
    });

    test("should call getSubcommand with false parameter", () => {
      const interaction = createMockInteraction("test");
      findFocusedOption(interaction);

      expect(interaction.options.getSubcommand).toHaveBeenCalledWith(false);
    });

    test("should call getFocused with true parameter", () => {
      const interaction = createMockInteraction("test");
      findFocusedOption(interaction);

      expect(interaction.options.getFocused).toHaveBeenCalledWith(true);
    });
  });

  describe("edge cases", () => {
    test("should handle null subcommand group", () => {
      const focusedOption = createMockFocusedOption("option", "value");
      const interaction = createMockInteraction(
        "command",
        undefined,
        "subcommand",
        focusedOption,
      );

      const result = findFocusedOption(interaction);

      expect(result?.path).toBe("command.subcommand");
    });

    test("should handle null subcommand", () => {
      const focusedOption = createMockFocusedOption("option", "value");
      const interaction = createMockInteraction(
        "command",
        "group",
        undefined,
        focusedOption,
      );

      const result = findFocusedOption(interaction);

      expect(result?.path).toBe("command.group");
    });

    test("should handle both null subcommand group and subcommand", () => {
      const focusedOption = createMockFocusedOption("option", "value");
      const interaction = createMockInteraction(
        "command",
        undefined,
        undefined,
        focusedOption,
      );

      const result = findFocusedOption(interaction);

      expect(result?.path).toBe("command");
    });
  });

  describe("real-world examples", () => {
    test("should handle tag get command", () => {
      const focusedOption = createMockFocusedOption("name", "welcome");
      const interaction = createMockInteraction(
        "tag",
        undefined,
        "get",
        focusedOption,
      );

      const result = findFocusedOption(interaction);

      expect(result).toEqual({
        path: "tag.get",
        option: focusedOption,
      });
    });

    test("should handle notification config delete command", () => {
      const focusedOption = createMockFocusedOption("type", "level");
      const interaction = createMockInteraction(
        "notification",
        "config",
        "delete",
        focusedOption,
      );

      const result = findFocusedOption(interaction);

      expect(result).toEqual({
        path: "notification.config.delete",
        option: focusedOption,
      });
    });

    test("should handle ban pool settings command", () => {
      const focusedOption = createMockFocusedOption("setting", "auto_ban");
      const interaction = createMockInteraction(
        "ban-pool",
        "settings",
        "toggle",
        focusedOption,
      );

      const result = findFocusedOption(interaction);

      expect(result).toEqual({
        path: "ban-pool.settings.toggle",
        option: focusedOption,
      });
    });
  });
});
