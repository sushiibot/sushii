import { describe, expect, mock, test } from "bun:test";
import pino from "pino";

import { ModerationCase } from "../../domain/entities/ModerationCase";
import { ActionType } from "../../domain/value-objects/ActionType";
import { DiscordModLogService } from "./DiscordModLogService";

const GUILD = "187450744427773963";
const CHANNEL = "1029384756102938400";

describe("DiscordModLogService", () => {
  test("posts warns through postEntry so waiting proof files go up too", async () => {
    const channel = { isSendable: () => true };
    const client = {
      guilds: {
        cache: new Map([
          [GUILD, { channels: { fetch: mock(async () => channel) } }],
        ]),
      },
    };
    const guildConfigRepository = {
      findByGuildId: mock(async () => ({
        loggingSettings: { modLogEnabled: true, modLogChannel: CHANNEL },
      })),
    };
    const postEntry = mock(async () => ({ id: "1029384756102938499" }));
    const service = new DiscordModLogService(
      client as never,
      guildConfigRepository as never,
      { postEntry } as never,
      pino({ level: "silent" }),
    );
    const moderationCase = new ModerationCase(
      GUILD,
      "4822",
      ActionType.Warn,
      new Date(),
      "912345678901234567",
      "spambot",
      "150443906511667200",
      null,
    );
    const user = { id: "912345678901234567" };

    const result = await service.sendModLog(
      GUILD,
      ActionType.Warn,
      { id: user.id, user } as never,
      moderationCase,
    );

    expect(result.ok && result.val).toBe("1029384756102938499");
    expect(postEntry).toHaveBeenCalledWith(channel, moderationCase, {
      targetUser: user,
    });
  });
});
