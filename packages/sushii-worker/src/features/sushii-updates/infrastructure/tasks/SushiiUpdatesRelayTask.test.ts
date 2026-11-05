import { describe, expect, mock, test } from "bun:test";
import type { Client } from "discord.js";
import { DiscordAPIError, RESTJSONErrorCodes } from "discord.js";
import type { Logger } from "pino";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";

import type { SushiiUpdatesCaptureService } from "../../application/SushiiUpdatesCaptureService";
import type { SushiiUpdatesRelayService } from "../../application/SushiiUpdatesRelayService";
import { SushiiUpdatesRelayTask } from "./SushiiUpdatesRelayTask";

const SOURCE = "391367772346777610";

function setup(catchUp: () => Promise<void>) {
  const logger = {
    warn: mock(),
    error: mock(),
    info: mock(),
    debug: mock(),
    child: () => logger,
  } as unknown as Logger & Record<string, ReturnType<typeof mock>>;
  const client = {
    channels: { cache: new Map([[SOURCE, {}]]) },
    guilds: { cache: new Map() },
    user: { id: "100000000000000001" },
  } as unknown as Client;
  const capture = {
    catchUp: mock(catchUp),
  } as unknown as SushiiUpdatesCaptureService & {
    catchUp: ReturnType<typeof mock>;
  };
  const relay = {
    run: mock(async () => undefined),
    housekeeping: mock(async () => undefined),
  } as unknown as SushiiUpdatesRelayService & {
    run: ReturnType<typeof mock>;
  };
  const deployment = {
    isCurrentDeploymentActive: () => true,
  } as unknown as DeploymentService;
  const task = new SushiiUpdatesRelayTask(
    client,
    deployment,
    logger,
    SOURCE,
    capture,
    relay,
  );
  const execute = () =>
    (task as unknown as { execute(): Promise<void> }).execute();
  return { execute, capture, relay, logger };
}

function accessError(): DiscordAPIError {
  return new DiscordAPIError(
    { code: RESTJSONErrorCodes.MissingAccess, message: "Missing Access" },
    RESTJSONErrorCodes.MissingAccess,
    403,
    "GET",
    `/channels/${SOURCE}/messages`,
    {},
  );
}

describe("SushiiUpdatesRelayTask catch-up", () => {
  test("catch-up runs once per process while the relay keeps running", async () => {
    const t = setup(async () => undefined);

    await t.execute();
    await t.execute();

    expect(t.capture.catchUp).toHaveBeenCalledTimes(1);
    expect(t.relay.run).toHaveBeenCalledTimes(2);
  });

  test("missing access to the source warns once and backs off", async () => {
    const t = setup(async () => {
      throw accessError();
    });

    await t.execute();
    await t.execute();

    expect(t.capture.catchUp).toHaveBeenCalledTimes(1);
    expect(t.logger.warn).toHaveBeenCalledTimes(1);
    expect(t.logger.error).not.toHaveBeenCalled();
  });

  test("other failures are errors and retried next run", async () => {
    const t = setup(async () => {
      throw new Error("db down");
    });

    await t.execute();
    await t.execute();

    expect(t.capture.catchUp).toHaveBeenCalledTimes(2);
    expect(t.logger.error).toHaveBeenCalledTimes(2);
  });
});
