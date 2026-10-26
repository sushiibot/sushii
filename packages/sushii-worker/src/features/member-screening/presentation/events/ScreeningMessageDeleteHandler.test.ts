import { describe, expect, mock, test } from "bun:test";
import { GatewayDispatchEvents, type GatewayDispatchPayload } from "discord.js";

import type { MemberScreeningService } from "../../application/MemberScreeningService";
import type { ActiveScreeningSettings } from "../../domain/types";
import { ScreeningMessageDeleteHandler } from "./ScreeningMessageDeleteHandler";

const GUILD = "100000000000000001";

function setup(active = true) {
  const recordMessagesDeleted = mock(async () => undefined);
  const find = mock(async () =>
    active ? ({ guildId: GUILD } as ActiveScreeningSettings) : null,
  );
  const handler = new ScreeningMessageDeleteHandler(
    { recordMessagesDeleted } as unknown as MemberScreeningService,
    { find },
  );
  return { handler, recordMessagesDeleted, find };
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

  test("skips DMs", async () => {
    const t = setup();
    await t.handler.handle(
      payload(GatewayDispatchEvents.MessageDelete, { id: "1" }),
    );
    expect(t.find).not.toHaveBeenCalled();
    expect(t.recordMessagesDeleted).not.toHaveBeenCalled();
  });

  test("skips guilds where screening isn't active", async () => {
    const t = setup(false);
    await t.handler.handle(
      payload(GatewayDispatchEvents.MessageDeleteBulk, {
        ids: ["1", "2"],
        guild_id: GUILD,
      }),
    );
    expect(t.find).toHaveBeenCalledWith(GUILD);
    expect(t.recordMessagesDeleted).not.toHaveBeenCalled();
  });
});
