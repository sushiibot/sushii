import { describe, expect, mock, test } from "bun:test";
import type { ChatInputCommandInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import type { Logger } from "pino";

import type { ScamImageHashService } from "../../application/ScamImageHashService";
import type { ScamImageHashRepository } from "../../domain/repositories/ScamImageHashRepository";
import { ScamHashCommand } from "./ScamHashCommand";

function setup() {
  const repository = {
    delete: mock(async (_id: number) => true),
    list: mock(
      async (): Promise<
        { id: number; label: string | null; addedAt: Date }[]
      > => [],
    ),
  };
  const command = new ScamHashCommand(
    repository as unknown as ScamImageHashRepository,
    {} as ScamImageHashService,
    { warn: mock() } as unknown as Logger,
  );
  return { command, repository };
}

function interaction(sub: string, id = 7) {
  const responses = {
    reply: mock(async (_payload: unknown) => undefined),
    deferReply: mock(async (_payload: unknown) => undefined),
    editReply: mock(async (_payload: unknown) => undefined),
  };
  const i = {
    ...responses,
    options: {
      getSubcommand: () => sub,
      getInteger: () => id,
    },
  };
  return {
    responses,
    interaction: i as unknown as ChatInputCommandInteraction,
  };
}

function expectOnlyReply(
  responses: ReturnType<typeof interaction>["responses"],
) {
  expect(responses.reply).toHaveBeenCalledTimes(1);
  expect(responses.deferReply).not.toHaveBeenCalled();
  expect(responses.editReply).not.toHaveBeenCalled();
  return responses.reply.mock.calls[0][0] as {
    content?: string;
    flags: number;
  };
}

describe("ScamHashCommand delete", () => {
  test("replies ephemerally that the entry was deleted", async () => {
    const t = setup();
    const { responses, interaction: i } = interaction("delete");

    await t.command.handler(i);

    expect(t.repository.delete).toHaveBeenCalledWith(7);
    expect(expectOnlyReply(responses)).toEqual({
      content: "Deleted entry ID **7**.",
      flags: MessageFlags.Ephemeral,
    });
  });

  test("replies ephemerally when there's no such entry", async () => {
    const t = setup();
    t.repository.delete.mockResolvedValue(false);
    const { responses, interaction: i } = interaction("delete");

    await t.command.handler(i);

    expect(expectOnlyReply(responses)).toEqual({
      content: "No entry found with ID **7**.",
      flags: MessageFlags.Ephemeral,
    });
  });
});

describe("ScamHashCommand list", () => {
  test("an empty list is one ephemeral reply", async () => {
    const t = setup();
    const { responses, interaction: i } = interaction("list");

    await t.command.handler(i);

    expect(expectOnlyReply(responses)).toEqual({
      content: "No scam hashes stored yet.",
      flags: MessageFlags.Ephemeral,
    });
  });

  test("entries are one ephemeral Components V2 reply", async () => {
    const t = setup();
    t.repository.list.mockResolvedValue([
      { id: 3, label: "promo", addedAt: new Date("2026-10-01T00:00:00Z") },
    ]);
    const { responses, interaction: i } = interaction("list");

    await t.command.handler(i);

    const reply = expectOnlyReply(responses);
    expect(reply.flags).toBe(
      MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    );
    expect(JSON.stringify(reply)).toContain("**#3** · promo · 2026-10-01");
  });
});
