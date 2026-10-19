import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import type { Logger } from "pino";

import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import type { ReactionStarterRepository } from "../domain/repositories/ReactionStarterRepository";
import type {
  GuildReactionBatch,
  ReactionEvent,
} from "../domain/types/ReactionEvent";
import { BATCH_WINDOW_MS } from "../domain/types/ReactionEvent";
import { ReactionBatchProcessor } from "./ReactionBatchProcessor";
import type { ReactionLogService } from "./ReactionLogService";

const GUILD_ID = "guild";

const enabledConfig = {
  loggingSettings: {
    reactionLogEnabled: true,
    reactionLogChannel: "log-channel",
  },
};

function removal(messageId: string, userId: string): ReactionEvent {
  return {
    messageId,
    channelId: "channel",
    guildId: GUILD_ID,
    userId,
    emojiString: "👍",
    emojiId: "👍",
    type: "remove",
    timestamp: new Date(),
    isInitial: false,
  };
}

function createLogger(): Logger {
  const logger = {
    trace: mock(),
    debug: mock(),
    info: mock(),
    warn: mock(),
    error: mock(),
  };
  return logger as unknown as Logger;
}

describe("ReactionBatchProcessor", () => {
  let timerCallbacks: (() => void)[];
  let setTimeoutSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    timerCallbacks = [];
    setTimeoutSpy = spyOn(globalThis, "setTimeout").mockImplementation(((
      cb: () => void,
      ms?: number,
    ) => {
      expect(ms).toBe(BATCH_WINDOW_MS);
      timerCallbacks.push(cb);
      return timerCallbacks.length as unknown as NodeJS.Timeout;
    }) as unknown as typeof setTimeout);
  });

  afterEach(() => {
    setTimeoutSpy.mockRestore();
  });

  test("reactions queued while a batch is being sent are logged in the next batch", async () => {
    // Snapshot removals at call time since batches are mutable maps.
    const loggedBatches: Map<string, string[]>[] = [];
    const { promise: sendGate, resolve: releaseSend } =
      Promise.withResolvers<undefined>();

    const reactionLogService = {
      logGuildBatch: mock(async (batch: GuildReactionBatch) => {
        await sendGate;
        loggedBatches.push(
          new Map(
            Array.from(batch.removals.entries()).map(([id, events]) => [
              id,
              events.map((e) => e.userId),
            ]),
          ),
        );
      }),
    } as unknown as ReactionLogService;

    const guildConfigRepository = {
      findByGuildId: mock(async () => enabledConfig),
    } as unknown as GuildConfigRepository;

    const starterRepository = {
      getStarters: mock(async () => []),
    } as unknown as ReactionStarterRepository;

    const processor = new ReactionBatchProcessor(
      starterRepository,
      reactionLogService,
      guildConfigRepository,
      createLogger(),
    );

    await processor.queueReactionRemoval(removal("msg-1", "user-1"));
    expect(timerCallbacks).toHaveLength(1);

    // Fire the batch window timer; processing is now awaiting the send.
    timerCallbacks[0]();
    await Bun.sleep(0);

    // A reaction arrives while the first batch is still being sent.
    await processor.queueReactionRemoval(removal("msg-2", "user-2"));

    releaseSend(undefined);
    await Bun.sleep(0);
    await Bun.sleep(0);

    expect(loggedBatches).toHaveLength(1);
    expect(Array.from(loggedBatches[0].keys())).toEqual(["msg-1"]);

    // The late reaction must still be pending in a new batch with its own timer.
    expect(processor.getStats().activeGuildBatches).toBe(1);
    expect(timerCallbacks).toHaveLength(2);

    timerCallbacks[1]();
    await Bun.sleep(0);
    await Bun.sleep(0);

    expect(loggedBatches).toHaveLength(2);
    expect(loggedBatches[1].get("msg-2")).toEqual(["user-2"]);
    expect(processor.getStats()).toEqual({
      activeGuildBatches: 0,
      activeTimers: 0,
      pendingCreations: 0,
    });
  });
});
