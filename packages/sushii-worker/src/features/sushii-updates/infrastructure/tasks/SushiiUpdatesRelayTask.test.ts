import { describe, expect, mock, test } from "bun:test";
import type { Client } from "discord.js";
import type { Logger } from "pino";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";

import type { SushiiUpdatesRelayService } from "../../application/SushiiUpdatesRelayService";
import { SushiiUpdatesRelayTask } from "./SushiiUpdatesRelayTask";

const SOURCE = "391367772346777610";

function setup(opts: {
  hasSource: boolean;
  housekeeping?: () => Promise<void>;
}) {
  const logger = {
    warn: mock(),
    error: mock(),
    info: mock(),
    debug: mock(),
    child: () => logger,
  } as unknown as Logger & Record<string, ReturnType<typeof mock>>;
  const client = {
    channels: { cache: new Map(opts.hasSource ? [[SOURCE, {}]] : []) },
    guilds: { cache: new Map() },
  } as unknown as Client;
  const relay = {
    run: mock(async () => undefined),
    housekeeping: mock(opts.housekeeping ?? (async () => undefined)),
  } as unknown as SushiiUpdatesRelayService & {
    run: ReturnType<typeof mock>;
    housekeeping: ReturnType<typeof mock>;
  };
  const deployment = {
    isCurrentDeploymentActive: () => true,
  } as unknown as DeploymentService;
  const task = new SushiiUpdatesRelayTask(
    client,
    deployment,
    logger,
    SOURCE,
    relay,
  );
  const execute = () =>
    (task as unknown as { execute(): Promise<void> }).execute();
  return { execute, relay, logger };
}

describe("SushiiUpdatesRelayTask", () => {
  test("only the cluster with the source channel runs cleanup", async () => {
    const withSource = setup({ hasSource: true });
    const without = setup({ hasSource: false });

    await withSource.execute();
    await without.execute();

    expect(withSource.relay.housekeeping).toHaveBeenCalledTimes(1);
    expect(without.relay.housekeeping).not.toHaveBeenCalled();
    expect(without.relay.run).toHaveBeenCalledTimes(1);
  });

  test("a cleanup failure doesn't stop forwarding", async () => {
    const t = setup({
      hasSource: true,
      housekeeping: async () => {
        throw new Error("db down");
      },
    });

    await t.execute();

    expect(t.logger.error).toHaveBeenCalledTimes(1);
    expect(t.relay.run).toHaveBeenCalledTimes(1);
  });
});
