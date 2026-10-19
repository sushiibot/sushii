import { describe, expect, mock, test } from "bun:test";
import type { ChatInputCommandInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import pino from "pino";
import { Ok } from "ts-results";

import type { GiveawayDrawService } from "../../application/GiveawayDrawService";
import type {
  EndGiveawayResult,
  GiveawayEndService,
} from "../../application/GiveawayEndService";
import type { GiveawayService } from "../../application/GiveawayService";
import { Giveaway } from "../../domain/entities/Giveaway";
import { GiveawayCommand } from "./GiveawayCommand";

const GUILD_ID = "100";
const GIVEAWAY_ID = "1";

function makeGiveaway(isEnded = false): Giveaway {
  return new Giveaway({
    id: GIVEAWAY_ID,
    channelId: "500",
    guildId: GUILD_ID,
    hostUserId: "400",
    numWinners: 3,
    prize: "Prize",
    startAt: new Date(Date.now() - 120_000),
    endAt: new Date(Date.now() + 60_000),
    isEnded,
  });
}

function makeInteraction() {
  return {
    reply: mock(async (_options: unknown) => undefined),
    deferReply: mock(async (_options: unknown) => undefined),
    editReply: mock(async (_options: unknown) => undefined),
    inCachedGuild: () => true,
    guildId: GUILD_ID,
    channelId: "500",
    options: {
      getSubcommand: () => "end",
      getString: () => GIVEAWAY_ID,
    },
  };
}

function setup(
  endResult: EndGiveawayResult | ((giveaway: Giveaway) => EndGiveawayResult),
  giveaway: Giveaway = makeGiveaway(),
) {
  const giveawayService = {
    getGiveaway: mock(async () => Ok(giveaway)),
  } as unknown as GiveawayService;

  const drawWinners = mock(async () =>
    Ok({ winnerIds: ["u1"], hasInsufficientWinners: false }),
  );
  const drawService = {
    drawWinners,
    sendWinnersMessage: mock(async () => Ok(undefined)),
  } as unknown as GiveawayDrawService;

  const endGiveaway = mock(async (g: Giveaway, _options: unknown) =>
    typeof endResult === "function" ? endResult(g) : endResult,
  );
  const endService = { endGiveaway } as unknown as GiveawayEndService;

  const command = new GiveawayCommand(
    giveawayService,
    drawService,
    endService,
    pino({ level: "silent" }),
  );

  const interaction = makeInteraction();

  return {
    command,
    interaction,
    endGiveaway,
    drawWinners,
    run: () =>
      command.handler(interaction as unknown as ChatInputCommandInteraction),
  };
}

function replyText(options: unknown): string {
  return JSON.stringify(options);
}

describe("GiveawayCommand /giveaway end", () => {
  test("ends the giveaway through the shared end routine", async () => {
    const { run, interaction, endGiveaway, drawWinners } = setup((g) => ({
      status: "ended",
      giveaway: g,
      winnerIds: ["u1", "u2", "u3"],
      hasInsufficientWinners: false,
    }));

    await run();

    // Shared routine flushes entries, claims atomically, draws numWinners and
    // updates the giveaway message
    expect(endGiveaway).toHaveBeenCalledTimes(1);
    const [giveaway, options] = endGiveaway.mock.calls[0];
    expect(giveaway.id).toBe(GIVEAWAY_ID);
    expect(options).toEqual({ endIfChannelUnavailable: false });
    expect(drawWinners).not.toHaveBeenCalled();

    expect(interaction.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
    expect(replyText(interaction.editReply.mock.calls[0]?.[0])).toContain(
      "Ended giveaway",
    );
  });

  test("tells the user when the giveaway was ended concurrently", async () => {
    const { run, interaction } = setup({ status: "alreadyEnded" });

    await run();

    expect(replyText(interaction.editReply.mock.calls[0]?.[0])).toContain(
      "Giveaway already ended",
    );
  });

  test("does not try to end a giveaway that is already ended", async () => {
    const { run, interaction, endGiveaway } = setup(
      { status: "alreadyEnded" },
      makeGiveaway(true),
    );

    await run();

    expect(endGiveaway).not.toHaveBeenCalled();
    expect(replyText(interaction.reply.mock.calls[0]?.[0])).toContain(
      "Giveaway already ended",
    );
  });

  test("reports when not enough winners were found", async () => {
    const { run, interaction } = setup((g) => ({
      status: "ended",
      giveaway: g,
      winnerIds: ["u1"],
      hasInsufficientWinners: true,
      reason: "Only 1 entries available, but 3 winners requested",
    }));

    await run();

    const text = replyText(interaction.editReply.mock.calls[0]?.[0]);
    expect(text).toContain("Not enough winners found");
    expect(text).toContain("Only 1 entries available");
  });

  test.each([
    [
      { status: "channelUnavailable", reason: "Missing Access" },
      "Channel not found",
    ],
    [{ status: "retry", reason: "guild unavailable" }, "Please try again"],
    [{ status: "drawFailed", error: "Database error" }, "Database error"],
  ] as [EndGiveawayResult, string][])(
    "reports a failure to end (%p)",
    async (result, expected) => {
      const { run, interaction } = setup(result);

      await run();

      expect(replyText(interaction.editReply.mock.calls[0]?.[0])).toContain(
        expected,
      );
    },
  );
});
