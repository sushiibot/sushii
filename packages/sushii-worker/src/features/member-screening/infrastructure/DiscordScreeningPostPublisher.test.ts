import { describe, expect, mock, test } from "bun:test";
import {
  type Client,
  ContainerBuilder,
  DiscordAPIError,
  MessageFlags,
  RESTJSONErrorCodes,
} from "discord.js";

import { DiscordScreeningPostPublisher } from "./DiscordScreeningPostPublisher";

const CHANNEL = "300000000000000009";
const POST = "700000000000000001";

function apiError(code: number): DiscordAPIError {
  const err = Object.create(DiscordAPIError.prototype) as DiscordAPIError;
  (err as unknown as { code: number }).code = code;
  return err;
}

function setup(editImpl?: () => Promise<unknown>) {
  const send = mock(async () => ({ id: POST }));
  const edit = mock(editImpl ?? (async () => ({})));
  const channel = {
    isSendable: () => true,
    isTextBased: () => true,
    send,
    messages: { edit },
  };
  const client = {
    channels: { fetch: mock(async () => channel) },
  } as unknown as Client;
  return { publisher: new DiscordScreeningPostPublisher(client), send, edit };
}

describe("DiscordScreeningPostPublisher", () => {
  test("posts components v2 without parsing mentions", async () => {
    const t = setup();
    const container = new ContainerBuilder();

    expect(await t.publisher.post(CHANNEL, container)).toBe(POST);
    expect(t.send).toHaveBeenCalledWith({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });
  });

  test("edits without parsing mentions", async () => {
    const t = setup();
    const container = new ContainerBuilder();

    expect(await t.publisher.edit(CHANNEL, POST, container)).toBe("edited");
    expect(t.edit).toHaveBeenCalledWith(POST, {
      components: [container],
      allowedMentions: { parse: [] },
    });
  });

  test.each([
    RESTJSONErrorCodes.UnknownMessage,
    RESTJSONErrorCodes.UnknownChannel,
  ])("maps Discord error %d to gone", async (code) => {
    const t = setup(async () => {
      throw apiError(code);
    });

    expect(await t.publisher.edit(CHANNEL, POST, new ContainerBuilder())).toBe(
      "gone",
    );
  });

  test("rethrows other errors", async () => {
    const t = setup(async () => {
      throw apiError(RESTJSONErrorCodes.MissingAccess);
    });

    await expect(
      t.publisher.edit(CHANNEL, POST, new ContainerBuilder()),
    ).rejects.toBeInstanceOf(DiscordAPIError);
  });
});
