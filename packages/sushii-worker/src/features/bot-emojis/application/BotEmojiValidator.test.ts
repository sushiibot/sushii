import { describe, expect, it } from "bun:test";
import { readdir } from "fs/promises";
import { join, resolve } from "path";

import { BotEmojiName } from "../domain/BotEmojiName";

const assetsDirectory = resolve(join(import.meta.dir, "../../../../assets"));

describe("BotEmojiValidator", () => {
  it("every BotEmojiName has a corresponding file in assets/", async () => {
    const files = await readdir(assetsDirectory);
    const assetNames = new Set(
      files
        .filter((f) => f.endsWith(".png.age") || f.endsWith(".png"))
        .map((f) => f.replace(/\.png\.age$/, "").replace(/\.png$/, "")),
    );

    const missing = BotEmojiName.options.filter((name) => !assetNames.has(name));
    expect(missing).toEqual([]);
  });

  it("every file in assets/ has a name in BotEmojiName", async () => {
    const files = await readdir(assetsDirectory);
    const assetFiles = files.filter(
      (f) => f.endsWith(".png.age") || f.endsWith(".png"),
    );

    const orphaned = assetFiles.filter((f) => {
      const name = f.replace(/\.png\.age$/, "").replace(/\.png$/, "");
      return !BotEmojiName.safeParse(name).success;
    });
    expect(orphaned).toEqual([]);
  });
});
