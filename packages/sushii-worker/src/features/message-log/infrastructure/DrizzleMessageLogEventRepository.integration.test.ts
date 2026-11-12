import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { eq } from "drizzle-orm";
import pino from "pino";

import { messagesInAppPublic } from "@/infrastructure/database/schema";
import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";

import { MessageLogEvent } from "../domain/entities/MessageLogEvent";
import type { MessageData } from "../domain/types/MessageData";
import { DrizzleMessageLogEventRepository } from "./DrizzleMessageLogEventRepository";

const GUILD = "100000000000000001";
const CHANNEL = "300000000000000001";
const APP = "400000000000000002";
const TRIGGERING_USER = "200000000000000002";
const MESSAGE = "500000000000000001";

function appEvent(
  content: string,
  extra: Partial<MessageData> = {},
): MessageLogEvent {
  return new MessageLogEvent(
    MESSAGE,
    APP,
    CHANNEL,
    GUILD,
    content,
    new Date("2026-03-10T12:00:00.000Z"),
    {
      id: MESSAGE,
      channel_id: CHANNEL,
      type: 20,
      author: {
        id: APP,
        username: "app",
        discriminator: "0",
        avatar: null,
        bot: true,
        global_name: null,
      },
      content,
      timestamp: "2026-03-10T12:00:00.000Z",
      ...extra,
    },
  );
}

const attribution: Partial<MessageData> = {
  member: { avatar: null, nick: null },
  interaction_metadata: {
    id: "600000000000000001",
    type: 2,
    user_id: TRIGGERING_USER,
    authorizing_integration_owners: { "1": TRIGGERING_USER },
  },
};

describe("DrizzleMessageLogEventRepository", () => {
  const testDb = new PostgresTestDatabase();
  let db: Awaited<ReturnType<PostgresTestDatabase["initialize"]>>;
  let repo: DrizzleMessageLogEventRepository;

  beforeAll(async () => {
    db = await testDb.initialize();
    repo = new DrizzleMessageLogEventRepository(db, pino({ level: "silent" }));
  });

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await db.delete(messagesInAppPublic);
  });

  async function storedRow() {
    const rows = await db
      .select()
      .from(messagesInAppPublic)
      .where(eq(messagesInAppPublic.messageId, BigInt(MESSAGE)));
    return rows[0];
  }

  test("save stores interaction_user_id", async () => {
    await repo.save(appEvent("", attribution));

    const row = await storedRow();
    expect(row.interactionUserId).toBe(BigInt(TRIGGERING_USER));
  });

  test("an update without attribution keeps the stored attribution", async () => {
    await repo.save(appEvent("", attribution));
    await repo.save(appEvent("done thinking"));

    const row = await storedRow();
    const msg = row.msg as MessageData;
    expect(row.content).toBe("done thinking");
    expect(msg.content).toBe("done thinking");
    expect(row.interactionUserId).toBe(BigInt(TRIGGERING_USER));
    expect(msg.interaction_metadata).toEqual(attribution.interaction_metadata);
    expect(msg.member).toEqual({ avatar: null, nick: null });
  });

  test("an update with new member data replaces the stored member", async () => {
    await repo.save(appEvent("", attribution));
    await repo.save(
      appEvent("edited", { member: { avatar: "abc", nick: "Nick" } }),
    );

    const msg = (await storedRow()).msg as MessageData;
    expect(msg.member).toEqual({ avatar: "abc", nick: "Nick" });
    expect(msg.interaction_metadata?.user_id).toBe(TRIGGERING_USER);
  });

  test("findByMessageIds returns the merged message data", async () => {
    await repo.save(appEvent("", attribution));
    await repo.save(appEvent("done thinking"));

    const [event] = await repo.findByMessageIds([MESSAGE]);
    expect(event.interactionUserId).toBe(TRIGGERING_USER);
    expect(event.discordMessage.content).toBe("done thinking");
  });

  test("updateIfChanged never inserts a message that was not cached", async () => {
    const updated = await repo.updateIfChanged(appEvent("done thinking"));

    expect(updated).toBe(false);
    expect(await storedRow()).toBeUndefined();
  });

  test("updateIfChanged skips the write when content and embeds are unchanged", async () => {
    await repo.save(
      appEvent("same", { ...attribution, embeds: [{ title: "Rank" }] }),
    );

    const updated = await repo.updateIfChanged(
      appEvent("same", {
        member: { avatar: "abc", nick: "Nick" },
        embeds: [{ title: "Rank" }],
      }),
    );

    expect(updated).toBe(false);
    const msg = (await storedRow()).msg as MessageData;
    expect(msg.member).toEqual({ avatar: null, nick: null });
  });

  test("updateIfChanged updates changed content and keeps attribution", async () => {
    await repo.save(appEvent("", attribution));

    const updated = await repo.updateIfChanged(
      appEvent("done thinking", { embeds: [{ title: "Result" }] }),
    );

    expect(updated).toBe(true);
    const row = await storedRow();
    const msg = row.msg as MessageData;
    expect(row.content).toBe("done thinking");
    expect(msg.embeds).toEqual([{ title: "Result" }]);
    expect(row.interactionUserId).toBe(BigInt(TRIGGERING_USER));
    expect(msg.interaction_metadata).toEqual(attribution.interaction_metadata);
  });

  test("updateIfChanged updates when only the embeds change", async () => {
    await repo.save(
      appEvent("same", { ...attribution, embeds: [{ title: "Old" }] }),
    );

    const updated = await repo.updateIfChanged(
      appEvent("same", { embeds: [{ title: "New" }] }),
    );

    expect(updated).toBe(true);
    const msg = (await storedRow()).msg as MessageData;
    expect(msg.embeds).toEqual([{ title: "New" }]);
    expect(msg.interaction_metadata?.user_id).toBe(TRIGGERING_USER);
  });

  test("updateIfChanged accepts an edit that still carries attribution", async () => {
    await repo.save(appEvent("", attribution));

    const updated = await repo.updateIfChanged(
      appEvent("done thinking", attribution),
    );

    expect(updated).toBe(true);
    const row = await storedRow();
    expect(row.content).toBe("done thinking");
    expect(row.interactionUserId).toBe(BigInt(TRIGGERING_USER));
  });
});
