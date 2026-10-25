import { expect, test } from "bun:test";
import type { Client } from "discord.js";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";

import type { WebhookService } from "@/features/webhook-logging/infrastructure/WebhookService";

import type { BotEmojiRepository } from "../domain/repositories/BotEmojiRepository";
import { BotEmojiSyncService } from "./BotEmojiSyncService";

test.each([1, 2])(
  "recipe %i emoji exports and bundled free icons load; collections never become emoji uploads",
  async (recipeVersion) => {
    const root = await mkdtemp(join(tmpdir(), "emoji-overlay-"));
    try {
      const buffer = Buffer.from("synthetic icon");
      const hash = createHash("sha256").update(buffer).digest("hex");
      for (const name of ["emoji/rep.png", "collection/koi.png"]) {
        await mkdir(join(root, name.split("/")[0]), { recursive: true });
        await writeFile(join(root, name), buffer);
      }
      await writeFile(
        join(root, "manifest.json"),
        JSON.stringify({
          schemaVersion: 1,
          recipeVersion,
          files: { "emoji/rep.png": hash, "collection/koi.png": hash },
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
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
