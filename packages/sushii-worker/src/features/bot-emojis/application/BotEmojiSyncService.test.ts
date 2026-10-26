import { expect, mock, test } from "bun:test";
import type { Client } from "discord.js";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";

import type { WebhookService } from "@/features/webhook-logging/infrastructure/WebhookService";

import { BotEmoji } from "../domain/entities/BotEmoji";
import type { BotEmojiRepository } from "../domain/repositories/BotEmojiRepository";
import type { BotEmojiService } from "./BotEmojiService";
import { BotEmojiSyncService } from "./BotEmojiSyncService";

test.each([1, 2])(
  "recipe %i emoji exports and bundled free icons load; collections never become emoji uploads",
  async (recipeVersion) => {
    const root = await mkdtemp(join(tmpdir(), "emoji-overlay-"));
    try {
      const buffer = Buffer.from("synthetic icon");
      const hash = createHash("sha256").update(buffer).digest("hex");
      const conditions = [
        "still",
        "light_rain",
        "heavy_rain",
        "mist",
        "moonlit",
      ] as const;
      const files = [
        "emoji/rep.png",
        "collection/koi.png",
        "symbol/next.png",
        ...conditions.map((c) => `symbol/${c}.png`),
      ];
      for (const name of files) {
        await mkdir(join(root, name.split("/")[0]), { recursive: true });
        await writeFile(join(root, name), buffer);
      }
      await writeFile(
        join(root, "manifest.json"),
        JSON.stringify({
          schemaVersion: 1,
          recipeVersion,
          files: Object.fromEntries(files.map((name) => [name, hash])),
        }),
      );
      const service = new BotEmojiSyncService(
        {} as Client,
        {} as BotEmojiRepository,
        {} as WebhookService,
        pino({ level: "silent" }),
        root,
      );
      const loaded = await service["loadAssets"]();
      expect(loaded.filter((a) => a.name === "rep")).toEqual([
        { name: "rep", buffer, hash },
      ]);
      expect(loaded.some((a) => String(a.name).includes("koi"))).toBe(false);
      expect(loaded.some((a) => a.name === "member_join")).toBe(true);
      expect(
        loaded
          .filter((a) => a.name.startsWith("fishing_"))
          .map((a) => a.name)
          .sort(),
      ).toEqual(conditions.map((c) => `fishing_${c}` as const).sort());
      expect(loaded.some((a) => String(a.name).includes("next"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("an untracked Discord emoji with the same name is replaced, not adopted", async () => {
  const buffer = Buffer.from("current art");
  const hash = createHash("sha256").update(buffer).digest("hex");
  const replaceEmoji = mock(async () => "222");
  const saveEmoji = mock(async () => undefined);
  const service = new BotEmojiSyncService(
    {} as Client,
    { saveEmoji } as unknown as BotEmojiRepository,
    {} as WebhookService,
    pino({ level: "silent" }),
  );
  Object.defineProperty(service, "emojiService", {
    value: { replaceEmoji } as unknown as BotEmojiService,
  });
  const result = {
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    errorMessages: [],
  };

  await service["syncSingleEmoji"](
    { name: "logs", buffer, hash },
    new Map([["logs", "111"]]),
    new Map(),
    result,
  );

  expect(replaceEmoji).toHaveBeenCalledWith("logs", "111", buffer);
  expect(saveEmoji).toHaveBeenCalledWith(new BotEmoji("logs", "222", hash));
  expect(result.updated).toBe(1);
});
