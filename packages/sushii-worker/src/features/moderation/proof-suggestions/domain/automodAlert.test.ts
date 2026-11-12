import { describe, expect, test } from "bun:test";

import { parseAutomodAlert } from "./automodAlert";

describe("parseAutomodAlert", () => {
  test("reads rule, channel and flagged content", () => {
    expect(
      parseAutomodAlert([
        {
          description: "free nitro discord.gg/abc",
          fields: [
            { name: "rule_name", value: "Block invites" },
            { name: "channel_id", value: "300000000000000001" },
            { name: "decision_id", value: "1" },
          ],
        },
      ]),
    ).toEqual({
      ruleName: "Block invites",
      blockedInChannelId: "300000000000000001",
      content: "free nitro discord.gg/abc",
    });
  });

  test("skips empty embeds and keeps channel optional", () => {
    expect(
      parseAutomodAlert([
        {},
        { fields: [{ name: "rule_name", value: "Names" }] },
      ]),
    ).toEqual({
      ruleName: "Names",
      blockedInChannelId: undefined,
      content: "",
    });
  });

  test("returns null without a rule_name field", () => {
    expect(parseAutomodAlert([{ description: "x" }])).toBeNull();
    expect(parseAutomodAlert(undefined)).toBeNull();
  });
});
