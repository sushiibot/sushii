import { describe, expect, mock, test } from "bun:test";
import { GatewayDispatchEvents, type GatewayDispatchPayload } from "discord.js";
import pino from "pino";

import type { MemberScreeningService } from "../../application/MemberScreeningService";
import type { ScreeningGuildRepository } from "../../domain/repositories/ScreeningGuildRepository";
import { ScreeningMessageDeleteHandler } from "./ScreeningMessageDeleteHandler";

const GUILD = "100000000000000001";

function setup(hasSettings = true) {
  const recordMessagesDeleted = mock(async () => undefined);
  const findByGuildId = mock(async () =>
    hasSettings ? { guildId: GUILD } : null,
  );
  const logger = pino({ level: "silent" });
  const warn = mock(() => undefined);
  logger.warn = warn as unknown as typeof logger.warn;
  let now = 0;
  const handler = new ScreeningMessageDeleteHandler(
    { recordMessagesDeleted } as unknown as MemberScreeningService,
    { findByGuildId } as unknown as ScreeningGuildRepository,
    logger,
    () => now,
  );
  const advance = (ms: number) => {
    now += ms;
  };
  return { handler, recordMessagesDeleted, findByGuildId, warn, advance };
}

function payload(t: GatewayDispatchEvents, d: Record<string, unknown>) {
  return { t, d } as unknown as GatewayDispatchPayload;
}

describe("ScreeningMessageDeleteHandler", () => {
  test("handles a single delete", async () => {
    const t = setup();

    await t.handler.handle(
      payload(GatewayDispatchEvents.MessageDelete, {
        id: "500000000000000001",
        guild_id: GUILD,
      }),
    );

    expect(t.recordMessagesDeleted).toHaveBeenCalledWith([
      "500000000000000001",
    ]);
  });

  test("handles a bulk delete", async () => {
    const t = setup();

    await t.handler.handle(
      payload(GatewayDispatchEvents.MessageDeleteBulk, {
        ids: ["500000000000000001", "500000000000000002"],
        guild_id: GUILD,
      }),
    );

    expect(t.recordMessagesDeleted).toHaveBeenCalledWith([
      "500000000000000001",
      "500000000000000002",
    ]);
  });

  test("skips DMs and guilds without settings", async () => {
    const dm = setup();
    await dm.handler.handle(
      payload(GatewayDispatchEvents.MessageDelete, { id: "1" }),
    );
    expect(dm.recordMessagesDeleted).not.toHaveBeenCalled();

    const t = setup(false);
    await t.handler.handle(
      payload(GatewayDispatchEvents.MessageDelete, {
        id: "1",
        guild_id: GUILD,
      }),
    );
    expect(t.recordMessagesDeleted).not.toHaveBeenCalled();
  });

  test("a failed settings lookup skips and warns at most once per minute", async () => {
    const t = setup();
    t.findByGuildId.mockImplementation(async () => {
      throw new Error("db down");
    });
    const event = payload(GatewayDispatchEvents.MessageDelete, {
      id: "500000000000000001",
      guild_id: GUILD,
    });

    await t.handler.handle(event);
    t.advance(30_000);
    await t.handler.handle(event);
    t.advance(30_000);
    await t.handler.handle(event);

    expect(t.recordMessagesDeleted).not.toHaveBeenCalled();
    expect(t.warn).toHaveBeenCalledTimes(2);
  });
});
