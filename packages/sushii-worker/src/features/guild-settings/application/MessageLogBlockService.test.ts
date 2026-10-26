import { describe, expect, mock, test } from "bun:test";
import pino from "pino";

import { MessageLogBlock } from "@/features/message-log/domain/entities/MessageLogBlock";
import type { MessageLogBlockRepository } from "@/features/message-log/domain/repositories/MessageLogBlockRepository";

import { MessageLogBlockService } from "./MessageLogBlockService";

const GUILD = "100000000000000001";
const CH_A = "300000000000000001";
const CH_B = "300000000000000002";
const CH_C = "300000000000000003";

function setup(existing: string[]) {
  const repo = {
    findByGuildId: mock(async (guildId: string) =>
      existing.map((id) => MessageLogBlock.create(guildId, id)),
    ),
    findByGuildAndChannel: mock(async () => null),
    addBlock: mock(async () => undefined),
    removeBlock: mock(async () => undefined),
  } satisfies MessageLogBlockRepository;

  return {
    service: new MessageLogBlockService(repo, pino({ level: "silent" })),
    repo,
  };
}

describe("MessageLogBlockService.setIgnoredChannels", () => {
  test("adds and removes only the differences", async () => {
    const t = setup([CH_A, CH_B]);

    await t.service.setIgnoredChannels(GUILD, [CH_B, CH_C]);

    expect(t.repo.addBlock).toHaveBeenCalledTimes(1);
    expect(t.repo.addBlock).toHaveBeenCalledWith(GUILD, CH_C);
    expect(t.repo.removeBlock).toHaveBeenCalledTimes(1);
    expect(t.repo.removeBlock).toHaveBeenCalledWith(GUILD, CH_A);
  });

  test("the same set makes no writes", async () => {
    const t = setup([CH_A, CH_B]);

    await t.service.setIgnoredChannels(GUILD, [CH_B, CH_A]);

    expect(t.repo.addBlock).not.toHaveBeenCalled();
    expect(t.repo.removeBlock).not.toHaveBeenCalled();
  });

  test("an empty set removes everything", async () => {
    const t = setup([CH_A, CH_B]);

    await t.service.setIgnoredChannels(GUILD, []);

    expect(t.repo.addBlock).not.toHaveBeenCalled();
    expect(t.repo.removeBlock).toHaveBeenCalledWith(GUILD, CH_A);
    expect(t.repo.removeBlock).toHaveBeenCalledWith(GUILD, CH_B);
  });

  test("duplicate IDs in the input are added once", async () => {
    const t = setup([]);

    await t.service.setIgnoredChannels(GUILD, [CH_A, CH_A]);

    expect(t.repo.addBlock).toHaveBeenCalledTimes(1);
    expect(t.repo.addBlock).toHaveBeenCalledWith(GUILD, CH_A);
  });
});
