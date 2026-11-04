import { describe, expect, test } from "bun:test";

import { type ReasonEmojis, reasonHeading } from "./reasonBlock";

const EMOJIS: ReasonEmojis = {
  additional_message: "<:additional_message:1>",
  reason: "<:reason:2>",
};

describe("reasonHeading", () => {
  test("sent", () => {
    expect(reasonHeading(EMOJIS, { sent: true, to: "spambot" })).toBe(
      "**<:additional_message:1> Reason** · sent to spambot by DM",
    );
    expect(reasonHeading(EMOJIS, { sent: true, to: "3 users" })).toBe(
      "**<:additional_message:1> Reason** · sent to 3 users by DM",
    );
  });

  test("not sent, with and without a cause", () => {
    expect(reasonHeading(EMOJIS, { sent: false })).toBe(
      "**<:reason:2> Reason** · not sent",
    );
    expect(reasonHeading(EMOJIS, { sent: false, why: "ban DMs are off" })).toBe(
      "**<:reason:2> Reason** · not sent (ban DMs are off)",
    );
  });

  test("escapes markdown in the username only", () => {
    expect(reasonHeading(EMOJIS, { sent: true, to: "__bold_guy__" })).toBe(
      "**<:additional_message:1> Reason** · sent to \\_\\_bold\\_guy\\_\\_ by DM",
    );
    expect(
      reasonHeading(EMOJIS, { sent: false, why: "off in `/settings`" }),
    ).toBe("**<:reason:2> Reason** · not sent (off in `/settings`)");
  });

  test("keeps the bold valid without emojis", () => {
    expect(
      reasonHeading(
        { additional_message: "", reason: "" },
        { sent: true, to: "user" },
      ),
    ).toBe("**Reason** · sent to user by DM");
  });
});
