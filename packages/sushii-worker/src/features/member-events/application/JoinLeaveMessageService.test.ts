import { describe, expect, mock, test } from "bun:test";
import type { GuildMember } from "discord.js";
import type { Logger } from "pino";

import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import { MessageTemplateService } from "../domain";
import { JoinLeaveMessageService } from "./JoinLeaveMessageService";

function setup(username: string) {
  const send = mock(async () => ({}));
  const channel = { id: "chan", isTextBased: () => true, send };
  const memberId = "111111111111111111";
  const member = {
    id: memberId,
    user: {
      id: memberId,
      username,
      toString: () => `<@${memberId}>`,
    },
    guild: {
      id: "guild",
      name: "Server",
      memberCount: 5,
      channels: { cache: new Map([["chan", channel]]) },
    },
  } as unknown as GuildMember;

  const repo = {
    findByGuildId: mock(async () => ({
      messageSettings: {
        messageChannel: "chan",
        joinMessageEnabled: true,
        joinMessage: "Welcome <mention> aka <username>",
        leaveMessageEnabled: true,
        leaveMessage: "Bye <username>",
      },
    })),
  } as unknown as GuildConfigRepository;

  const logger = { warn: mock(), info: mock() } as unknown as Logger;
  const service = new JoinLeaveMessageService(
    repo,
    new MessageTemplateService(),
    logger,
  );

  return { service, member, send, memberId };
}

describe("JoinLeaveMessageService", () => {
  test("sends join message with restricted allowedMentions", async () => {
    const { service, member, send, memberId } = setup("@everyone");

    await service.sendJoinMessage(member);

    expect(send).toHaveBeenCalledWith({
      content: `Welcome <@${memberId}> aka @everyone`,
      allowedMentions: { parse: [], users: [memberId], roles: [] },
    });
  });

  test("sends leave message with restricted allowedMentions", async () => {
    const { service, member, send, memberId } = setup("bob");

    await service.sendLeaveMessage(member);

    expect(send).toHaveBeenCalledWith({
      content: "Bye bob",
      allowedMentions: { parse: [], users: [memberId], roles: [] },
    });
  });
});
