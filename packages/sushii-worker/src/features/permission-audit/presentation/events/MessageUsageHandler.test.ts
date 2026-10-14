import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Collection, type Message } from "discord.js";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";

import type { PermissionUsageRecorder } from "../../application/PermissionUsageRecorder";
import { MessageUsageHandler } from "./MessageUsageHandler";

const CHANNEL_ID = "600000000000000006";

interface MessageOptions {
  inGuild?: boolean;
  webhookId?: string | null;
  system?: boolean;
  everyone?: boolean;
  tts?: boolean;
  roles?: { mentionable: boolean }[];
}

function createMessage(options: MessageOptions = {}): Message {
  const roles = new Collection<string, { mentionable: boolean }>(
    (options.roles ?? []).map((role, i) => [String(i), role]),
  );

  return {
    inGuild: () => options.inGuild ?? true,
    webhookId: options.webhookId ?? null,
    system: options.system ?? false,
    tts: options.tts ?? false,
    guildId: "200000000000000002",
    channelId: CHANNEL_ID,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    author: { id: "300000000000000003" },
    mentions: { everyone: options.everyone ?? false, roles },
  } as unknown as Message;
}

describe("MessageUsageHandler", () => {
  let recordMessage: ReturnType<typeof mock>;
  let isExempt: ReturnType<typeof mock>;
  let handler: MessageUsageHandler;

  beforeEach(() => {
    recordMessage = mock(() => Promise.resolve());
    isExempt = mock(() => false);
    handler = new MessageUsageHandler(
      { recordMessage } as unknown as PermissionUsageRecorder,
      {
        isChannelExemptFromDeploymentCheck: isExempt,
      } as unknown as DeploymentService,
    );
  });

  test("records @everyone", async () => {
    await handler.handle(createMessage({ everyone: true }));

    expect(recordMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        mentionsEveryone: true,
        mentionsNonMentionableRole: false,
        channelId: CHANNEL_ID,
      }),
    );
  });

  test("records pings of non-mentionable roles", async () => {
    await handler.handle(
      createMessage({ roles: [{ mentionable: true }, { mentionable: false }] }),
    );

    expect(recordMessage).toHaveBeenCalledWith(
      expect.objectContaining({ mentionsNonMentionableRole: true }),
    );
  });

  test("ignores pings of mentionable roles", async () => {
    await handler.handle(createMessage({ roles: [{ mentionable: true }] }));

    expect(recordMessage).not.toHaveBeenCalled();
  });

  test("ignores plain messages", async () => {
    await handler.handle(createMessage());

    expect(recordMessage).not.toHaveBeenCalled();
  });

  test.each<[string, MessageOptions]>([
    ["DMs", { inGuild: false, everyone: true }],
    ["webhook messages", { webhookId: "700000000000000007", everyone: true }],
    ["system messages", { system: true, everyone: true }],
  ])("ignores %s", async (_, options) => {
    await handler.handle(createMessage(options));

    expect(recordMessage).not.toHaveBeenCalled();
  });

  test("ignores deployment-exempt channels", async () => {
    isExempt.mockImplementation(() => true);

    await handler.handle(createMessage({ everyone: true }));

    expect(isExempt).toHaveBeenCalledWith(CHANNEL_ID);
    expect(recordMessage).not.toHaveBeenCalled();
  });
});
