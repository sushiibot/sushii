import { describe, expect, it } from "bun:test";
import { readdir } from "fs/promises";
import { join, resolve } from "path";

import { BotEmojiName } from "../domain/BotEmojiName";

const assetsDirectory = resolve(join(import.meta.dir, "../../../../assets"));

describe("BotEmojiValidator", () => {
  it("bundles only the reviewed free icons; paid icons come from the private mount", async () => {
    const files = await readdir(assetsDirectory);
    expect(files.sort()).toEqual([
      "member_join.png",
      "member_leave.png",
      "message_delete.png",
      "message_edit.png",
      "shield.png",
      "sound_off.png",
    ]);
  });

  it("every bundled icon has a name in BotEmojiName", async () => {
    const files = await readdir(assetsDirectory);
    const orphaned = files.filter((file) => {
      const name = file.replace(/\.png$/, "");
      return !BotEmojiName.safeParse(name).success;
    });
    expect(orphaned).toEqual([]);
  });
});
