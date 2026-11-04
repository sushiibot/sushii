import { describe, expect, test } from "bun:test";

import {
  GUILD,
  OTHER_MOD,
  makeCase,
} from "@/features/moderation/actions/presentation/response/testFixtures";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import { GuildConfig } from "@/shared/domain/entities/GuildConfig";

import {
  type ReasonEmojis,
  notSentWhy,
  reasonDelivery,
  reasonHeading,
  serverDmTextIncluded,
} from "./reasonBlock";

const EMOJIS: ReasonEmojis = {
  dm_sent: "<:dm_sent:1>",
  reason: "<:reason:2>",
};

describe("reasonHeading", () => {
  test("sent", () => {
    expect(reasonHeading(EMOJIS, { sent: true, to: "spambot" })).toBe(
      "**<:dm_sent:1> Reason** · sent to spambot by DM",
    );
    expect(reasonHeading(EMOJIS, { sent: true, to: "3 users" })).toBe(
      "**<:dm_sent:1> Reason** · sent to 3 users by DM",
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
      "**<:dm_sent:1> Reason** · sent to \\_\\_bold\\_guy\\_\\_ by DM",
    );
    expect(
      reasonHeading(EMOJIS, { sent: false, why: "off in `/settings`" }),
    ).toBe("**<:reason:2> Reason** · not sent (off in `/settings`)");
  });

  test("keeps the bold valid without emojis", () => {
    expect(
      reasonHeading(
        { dm_sent: "", reason: "" },
        { sent: true, to: "user" },
      ),
    ).toBe("**Reason** · sent to user by DM");
  });
});

describe("reasonDelivery", () => {
  test("a live DM is sent", () => {
    expect(reasonDelivery(makeCase())).toEqual({ sent: true });
  });

  test("the same why texts as the mod log", () => {
    expect(
      reasonDelivery(makeCase({ dm: null, dmIntentSource: "executor_no" })),
    ).toEqual({ sent: false, why: "the mod chose no DM" });
    expect(
      reasonDelivery(
        makeCase({
          actionType: ActionType.TempBan,
          dm: null,
          dmIntentSource: "guild_default",
        }),
      ),
    ).toEqual({ sent: false, why: "ban DMs are off" });
    expect(
      reasonDelivery(
        makeCase({
          dm: { error: "x", failureReason: "user_cannot_receive" },
        }),
      ),
    ).toEqual({
      sent: false,
      why: "DM failed: Discord won't deliver DMs to them",
    });
    expect(reasonDelivery(makeCase({ dmDeleted: true }))).toEqual({
      sent: false,
      why: `DM deleted by <@${OTHER_MOD}>`,
    });
  });

  test("actions without a DM have no why", () => {
    expect(
      reasonDelivery(makeCase({ actionType: ActionType.Note, dm: null })),
    ).toEqual({ sent: false, why: null });
  });
});

describe("notSentWhy", () => {
  test("names the setting for the action's DM kind", () => {
    expect(notSentWhy("guild_default", ActionType.TimeoutAdjust)).toBe(
      "timeout DMs are off",
    );
    expect(notSentWhy("not_in_guild", ActionType.Ban)).toBe(
      "they weren't in the server",
    );
    expect(notSentWhy(null, ActionType.Ban)).toBeNull();
  });
});

describe("serverDmTextIncluded", () => {
  function config(banDmText: string | null): GuildConfig {
    const base = GuildConfig.createDefault(GUILD);
    return {
      ...base,
      moderationSettings: { ...base.moderationSettings, banDmText },
    } as GuildConfig;
  }

  test("only for a delivered DM with the action's server text set", () => {
    expect(serverDmTextIncluded(makeCase(), config("Appeal at x"))).toBe(true);
    expect(serverDmTextIncluded(makeCase(), config("  "))).toBe(false);
    expect(
      serverDmTextIncluded(makeCase({ dm: null }), config("Appeal at x")),
    ).toBe(false);
    expect(
      serverDmTextIncluded(makeCase({ dmDeleted: true }), config("x")),
    ).toBe(false);
  });
});
