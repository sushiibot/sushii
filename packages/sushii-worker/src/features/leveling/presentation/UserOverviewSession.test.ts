import { expect, mock, test } from "bun:test";
import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  User,
} from "discord.js";
import pino from "pino";

import { OpenFishyCollectionButtonHandler } from "./OpenFishyCollectionButtonHandler";
import { UserOverviewComponentHandler } from "./UserOverviewComponentHandler";
import {
  type UserOverviewDependencies,
  UserOverviewSession,
} from "./UserOverviewSession";

const owner = "111111111111111111";
const target = { id: "222222222222222222", username: "Target" } as User;
const json = (value: unknown) => JSON.stringify(value);
function fixture(hosted = true, empty = false) {
  const edits: unknown[] = [];
  const deferReply = mock(() => {
    throw new Error("Openers must reply directly");
  });
  const reply = mock(async (message: { components?: unknown }) => {
    if (message.components) edits.push(message);
  });
  const getCollection = mock(async (_id: string) =>
    empty ? [] : [{ collectibleId: "bluegill", catchCount: 2 }],
  );
  const interaction = {
    guildId: "guild",
    user: { id: owner },
    deferReply,
    reply,
    inCachedGuild: () => true,
    client: { users: { fetch: async () => target } },
    message: { interactionMetadata: { user: target } },
    editReply: () => {
      throw new Error("Openers must send one reply");
    },
  } as unknown as ChatInputCommandInteraction<"cached">;
  const deps = {
    collectionRepository: { getCollection },
    artwork: {
      url: async (id: string, silhouette: boolean) =>
        hosted
          ? `https://assets.example.test/${id}${silhouette ? "-silhouette" : ""}.png`
          : undefined,
      icon: async () => {
        if (hosted) throw new Error("Hosted pages must not upload images");
        return Buffer.from("synthetic image");
      },
    },
    logger: pino({ level: "silent" }),
  } as unknown as UserOverviewDependencies;
  const session = new UserOverviewSession(
    interaction,
    target,
    deps,
    "collection",
  );
  const click = async (action: string, value?: string, userId = owner) => {
    const payload = json(edits.at(-1));
    const ids = [...payload.matchAll(/"custom_id":"([^"]+)"/g)].map(
      (match) => match[1] ?? "",
    );
    const customId = ids.find((id) => id.endsWith(`/${action}`)) ?? "";
    expect(customId).toBeDefined();
    const component = {
      ...interaction,
      customId,
      user: { id: userId },
      values: value ? [value] : [],
      deferUpdate: () => {
        throw new Error("Navigation must acknowledge with update");
      },
      editReply: () => {
        throw new Error("Navigation must send one update");
      },
      update: mock(async (message: unknown) => {
        edits.push(message);
      }),
      isButton: () => value === undefined,
      isStringSelectMenu: () => value !== undefined,
    } as unknown as ButtonInteraction<"cached">;
    // Fresh handler for every click simulates loss of all process/session state.
    const handler = new UserOverviewComponentHandler(deps);
    expect(handler.customIDMatch(customId)).not.toBe(false);
    await handler.handleInteraction(component);
    expect(component.update).toHaveBeenCalledTimes(userId === owner ? 1 : 0);
  };
  return {
    session,
    edits,
    click,
    deps,
    interaction,
    deferReply,
    reply,
    getCollection,
  };
}

test("Open collection creates a public reply and navigation works in fresh handlers", async () => {
  const f = fixture();
  await new OpenFishyCollectionButtonHandler(f.deps).handleInteraction(
    f.interaction as unknown as ButtonInteraction,
  );
  expect(f.deferReply).not.toHaveBeenCalled();
  expect(f.reply).toHaveBeenCalledTimes(1);
  expect(json(f.edits.at(-1))).toContain("Page 1/8");
  await f.click("next");
  expect(json(f.edits.at(-1))).toContain("Page 2/8");
  await f.click("next");
  expect(json(f.edits.at(-1))).toContain("Page 3/8");
  await f.click("previous");
  expect(json(f.edits.at(-1))).toContain("Page 2/8");
  expect(f.getCollection).toHaveBeenLastCalledWith(target.id);
});

test("collected filter resets pagination, intersects sets and can be toggled off", async () => {
  const f = fixture();
  await f.session.start();
  await f.click("next");
  await f.click("collected");
  let payload = json(f.edits.at(-1));
  expect(payload).toContain("Caught ×2");
  expect(payload).not.toContain("Undiscovered");
  expect(payload).not.toContain("Page ");
  await f.click("set", "sea");
  expect(json(f.edits.at(-1))).toContain(
    "No collected fishies in this set yet.",
  );
  await f.click("set", "pond");
  expect(json(f.edits.at(-1))).toContain("Caught ×2");
  await f.click("collected");
  payload = json(f.edits.at(-1));
  expect(payload).toContain("Undiscovered");
  expect(payload).toContain("Page 1/");
});

test("empty collected view has guidance and other users cannot change it", async () => {
  const f = fixture(true, true);
  await f.session.start();
  await f.click("collected");
  expect(json(f.edits.at(-1))).toContain("No fishies collected yet.");
  const before = f.edits.length;
  await f.click("collected", undefined, "333333333333333333");
  expect(f.edits).toHaveLength(before);
  expect(json(f.reply.mock.calls)).toContain("open your own view");
});

test("hosted pages use URLs, fallback pages upload attachments, controls fit Discord limits", async () => {
  for (const hosted of [true, false]) {
    const f = fixture(hosted);
    const message = await f.session["render"]();
    if (hosted) {
      expect(message.files).toEqual([]);
      expect(json(message)).toContain(
        "https://assets.example.test/bluegill.png",
      );
      expect(json(message)).toContain("carp-silhouette.png");
    } else {
      expect(message.files).toHaveLength(4);
      expect(json(message)).toContain("attachment://bluegill.png");
    }
    for (const match of json(message).matchAll(/"custom_id":"([^"]+)"/g)) {
      expect((match[1] ?? "").length).toBeLessThanOrEqual(100);
    }
  }
});

test("legacy controls get a useful reply instead of timing out", async () => {
  const f = fixture();
  const handler = new UserOverviewComponentHandler(f.deps);
  for (const action of ["rank", "collection", "previous", "next", "set"]) {
    const customId = `fishycollection:${action}`;
    expect(handler.customIDMatch(customId)).not.toBe(false);
    await handler.handleInteraction({
      ...f.interaction,
      customId,
    } as unknown as ButtonInteraction);
  }
  expect(f.reply).toHaveBeenCalledTimes(5);
  expect(json(f.reply.mock.calls)).toContain("older view has expired");
});
