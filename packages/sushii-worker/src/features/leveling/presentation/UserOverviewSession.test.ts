import { expect, test } from "bun:test";
import type { ChatInputCommandInteraction, User } from "discord.js";
import { EventEmitter } from "node:events";
import pino from "pino";

import {
  type UserOverviewDependencies,
  UserOverviewSession,
} from "./UserOverviewSession";

function fixture() {
  const collector = new EventEmitter();
  const edits: unknown[] = [];
  let requester = "";
  const interaction = {
    guildId: "guild",
    user: { id: "owner" },
    deferReply: () => Promise.resolve(),
    editReply: async (message: unknown) => {
      edits.push(message);
      return { createMessageComponentCollector: () => collector };
    },
  } as unknown as ChatInputCommandInteraction<"cached">;
  const deps = {
    collectionRepository: {
      getCollection: async (id: string) => {
        requester = id;
        return [{ collectibleId: "bluegill", catchCount: 2 }];
      },
    },
    artwork: { icon: async () => Buffer.from("synthetic image") },
    logger: pino({ level: "silent" }),
  } as unknown as UserOverviewDependencies;
  const session = new UserOverviewSession(
    interaction,
    { id: "target", username: "Target" } as User,
    deps,
    "collection",
  );
  return { collector, edits, session, requester: () => requester };
}
const json = (value: unknown) => JSON.stringify(value);

test("collection retains target and clamps set pagination", async () => {
  const f = fixture();
  await f.session.start();
  expect(f.requester()).toBe("target");
  expect(json(f.edits.at(-1))).toContain("Page 1/8");
  f.session["page"] = 100;
  f.session["set"] = "pond";
  const message = await f.session["render"]();
  expect(json(message)).not.toContain("Page 101");
  expect(json(message)).toContain("Pond Friends");
  expect(message.attachments).toEqual([]);
});

test("other users cannot navigate and expired controls are disabled", async () => {
  const f = fixture();
  await f.session.start();
  let rejected = false;
  f.collector.emit("collect", {
    user: { id: "someone-else" },
    reply: async () => {
      rejected = true;
    },
  });
  await Promise.resolve();
  expect(rejected).toBe(true);
  expect(f.edits).toHaveLength(1);
  f.collector.emit("end");
  await f.session["queue"];
  const payload = JSON.parse(json(f.edits.at(-1)));
  const rows = payload.components[0].components.filter(
    (component: { type: number }) => component.type === 1,
  );
  expect(rows).toHaveLength(3);
  for (const row of rows)
    for (const control of row.components) expect(control.disabled).toBe(true);
});

test("set changes reset the page and rapid clicks render in order", async () => {
  const f = fixture();
  await f.session.start();
  const click = (id: string) => ({
    user: { id: "owner" },
    customId: id,
    deferUpdate: () => Promise.resolve(),
    isStringSelectMenu: () => false,
    isButton: () => true,
    followUp: () => Promise.resolve(),
  });
  f.collector.emit("collect", click("fishycollection:next"));
  f.collector.emit("collect", click("fishycollection:next"));
  await new Promise((resolve) => setImmediate(resolve));
  await f.session["queue"];
  expect(json(f.edits.at(-1))).toContain("Page 3/8");
  f.collector.emit("collect", {
    ...click("fishycollection:set"),
    values: ["pond"],
    isStringSelectMenu: () => true,
    isButton: () => false,
  });
  await new Promise((resolve) => setImmediate(resolve));
  await f.session["queue"];
  expect(json(f.edits.at(-1))).toContain("Page 1/");
  expect(f.requester()).toBe("target");
});
