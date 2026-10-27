import { describe, expect, mock, test } from "bun:test";
import type { ButtonInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import type { Logger } from "pino";

import type { ScamHashReportService } from "../../application/ScamHashReportService";
import { ScamHashReportButtonHandler } from "./ScamHashReportButtonHandler";
import { buildReportHashId } from "./automodAlertExtraCustomIds";

function setup(ok: boolean) {
  const service = {
    submitReport: mock(async () =>
      ok ? { ok: true } : { ok: false, reason: "not_found" },
    ),
  };
  const handler = new ScamHashReportButtonHandler(
    service as unknown as ScamHashReportService,
    { warn: mock() } as unknown as Logger,
  );
  const responses = {
    reply: mock(async (_payload: unknown) => undefined),
    deferReply: mock(async (_payload: unknown) => undefined),
    editReply: mock(async (_payload: unknown) => undefined),
  };
  const messageEdit = mock(async (_payload: unknown) => undefined);
  const interaction = {
    ...responses,
    customId: buildReportHashId(42),
    inCachedGuild: () => true,
    guildId: "100000000000000001",
    guild: { name: "Guild" },
    user: { id: "200000000000000001" },
    message: {
      id: "300000000000000001",
      edit: messageEdit,
      toJSON: () => ({ components: [] }),
    },
  };
  return {
    handler,
    service,
    responses,
    messageEdit,
    interaction: interaction as unknown as ButtonInteraction,
  };
}

describe("ScamHashReportButtonHandler report", () => {
  test("a successful report is one ephemeral reply", async () => {
    const t = setup(true);

    await t.handler.handleInteraction(t.interaction);

    expect(t.service.submitReport).toHaveBeenCalledTimes(1);
    expect(t.responses.reply).toHaveBeenCalledTimes(1);
    expect(t.responses.reply).toHaveBeenCalledWith({
      content: "Sent for review, thank you!",
      flags: MessageFlags.Ephemeral,
    });
    expect(t.responses.deferReply).not.toHaveBeenCalled();
    expect(t.responses.editReply).not.toHaveBeenCalled();
  });

  test("a report for a missing hash is one ephemeral reply", async () => {
    const t = setup(false);

    await t.handler.handleInteraction(t.interaction);

    expect(t.responses.reply).toHaveBeenCalledTimes(1);
    expect(t.responses.reply).toHaveBeenCalledWith({
      content:
        "Couldn't send this for review — the hash entry may already be gone.",
      flags: MessageFlags.Ephemeral,
    });
    expect(t.responses.deferReply).not.toHaveBeenCalled();
    expect(t.responses.editReply).not.toHaveBeenCalled();
  });
});
