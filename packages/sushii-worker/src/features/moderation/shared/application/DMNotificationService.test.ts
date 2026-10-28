import { describe, expect, mock, test } from "bun:test";
import type { Client, EmbedBuilder } from "discord.js";
import { DiscordAPIError, RESTJSONErrorCodes } from "discord.js";
import pino from "pino";

import type { GuildConfig } from "@/shared/domain/entities/GuildConfig";

import { ModerationCase } from "../domain/entities/ModerationCase";
import { ActionType } from "../domain/value-objects/ActionType";
import { Reason } from "../domain/value-objects/Reason";
import { DMNotificationService } from "./DMNotificationService";

const GUILD = "187450744427773963";
const DM_CHANNEL = "1029384756102938400";
const DM_MESSAGE = "1029384756102938401";
const ACTION_TIME = new Date("2026-10-27T11:00:00.000Z");

const guildConfig = {
  moderationSettings: { timeoutDmText: "Read the rules.", banDmText: null },
} as unknown as GuildConfig;

const guild = {
  id: GUILD,
  name: "sushii",
  iconURL: () => null,
};

function makeCase(
  overrides: {
    actionType?: ActionType;
    dm?: boolean;
    dmDeleted?: boolean;
    timeoutDuration?: number | null;
  } = {},
): ModerationCase {
  const moderationCase = new ModerationCase(
    GUILD,
    "4822",
    overrides.actionType ?? ActionType.Timeout,
    ACTION_TIME,
    "912345678901234567",
    "spambot",
    "150443906511667200",
    Reason.create("New reason").unwrap(),
    null,
    [],
    overrides.dm === false
      ? null
      : { channelId: DM_CHANNEL, messageId: DM_MESSAGE },
    false,
    overrides.timeoutDuration === undefined ? 3600 : overrides.timeoutDuration,
  );
  return overrides.dmDeleted ? moderationCase.withDmDeleted() : moderationCase;
}

function makeClient(channel: unknown, fetchError?: Error) {
  return {
    guilds: { cache: new Map([[GUILD, guild]]) },
    channels: {
      fetch: fetchError
        ? mock(async () => {
            throw fetchError;
          })
        : mock(async () => channel),
    },
  } as unknown as Client;
}

function dmChannel(edit = mock(async () => undefined)) {
  return {
    isDMBased: () => true,
    isTextBased: () => true,
    messages: { edit },
  };
}

const service = new DMNotificationService(pino({ level: "silent" }));

describe("DMNotificationService.buildCaseDMEmbed", () => {
  test("matches what sendModerationDM sends, with the new reason", () => {
    const embed = service
      .buildCaseDMEmbed(guild as never, makeCase(), guildConfig)
      .toJSON();

    expect(embed.title).toBe("You have been timed out");
    expect(embed.description).toBe("**Reason**\nNew reason");
    expect(embed.author?.name).toBe("sushii");
    const end = ACTION_TIME.getTime() / 1000 + 3600;
    expect(embed.fields).toEqual([
      { name: "Duration", value: `Your timeout will expire <t:${end}:R>` },
      { name: "Additional Information", value: "Read the rules." },
    ]);
  });

  test("an adjusted timeout reads like the timeout DM it replaces", () => {
    const embed = service
      .buildCaseDMEmbed(
        guild as never,
        makeCase({ actionType: ActionType.TimeoutAdjust }),
        guildConfig,
      )
      .toJSON();

    expect(embed.title).toBe("You have been timed out");
    const end = ACTION_TIME.getTime() / 1000 + 3600;
    expect(embed.fields).toEqual([
      { name: "Duration", value: `Your timeout will expire <t:${end}:R>` },
      { name: "Additional Information", value: "Read the rules." },
    ]);
  });

  test("bans have no duration", () => {
    const embed = service
      .buildCaseDMEmbed(
        guild as never,
        makeCase({ actionType: ActionType.Ban, timeoutDuration: null }),
        guildConfig,
      )
      .toJSON();

    expect(embed.title).toBe("You have been banned");
    expect(embed.fields ?? []).toEqual([]);
  });
});

describe("DMNotificationService.editCaseDM", () => {
  test("edits the DM in place", async () => {
    const edit = mock(async () => undefined);
    const client = makeClient(dmChannel(edit));

    const outcome = await service.editCaseDM(client, makeCase(), guildConfig);

    expect(outcome).toBe("updated");
    const [messageId, payload] = edit.mock.calls[0] as unknown as [
      string,
      { embeds: EmbedBuilder[] },
    ];
    expect(messageId).toBe(DM_MESSAGE);
    expect(payload.embeds[0]?.toJSON().description).toBe(
      "**Reason**\nNew reason",
    );
  });

  test("no DM to edit when none was delivered or it was deleted", async () => {
    const client = makeClient(dmChannel());

    expect(
      await service.editCaseDM(client, makeCase({ dm: false }), guildConfig),
    ).toBe("no_dm");
    expect(
      await service.editCaseDM(
        client,
        makeCase({ dmDeleted: true }),
        guildConfig,
      ),
    ).toBe("no_dm");
  });

  test("a deleted message, blocked bot or missing user is an outcome, not a throw", async () => {
    for (const code of [
      RESTJSONErrorCodes.UnknownMessage,
      RESTJSONErrorCodes.CannotSendMessagesToThisUser,
      RESTJSONErrorCodes.UnknownChannel,
    ]) {
      const error = new DiscordAPIError(
        { message: "x", code },
        code,
        403,
        "PATCH",
        "/channels/1/messages/2",
        {},
      );
      const edit = mock(async () => {
        throw error;
      });

      expect(
        await service.editCaseDM(
          makeClient(dmChannel(edit)),
          makeCase(),
          guildConfig,
        ),
      ).toBe("failed");
      expect(
        await service.editCaseDM(
          makeClient(null, error),
          makeCase(),
          guildConfig,
        ),
      ).toBe("failed");
    }
  });

  test("a channel that isn't a DM fails", async () => {
    const client = makeClient({
      isDMBased: () => false,
      isTextBased: () => true,
    });

    expect(await service.editCaseDM(client, makeCase(), guildConfig)).toBe(
      "failed",
    );
  });
});
