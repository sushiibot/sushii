import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadAssetExports } from "./AssetExports";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "sushii-assets-"));
  directories.push(root);
  const data = Buffer.from("synthetic fixture");
  const hash = createHash("sha256").update(data).digest("hex");
  await mkdir(join(root, "emoji"));
  await writeFile(join(root, "emoji/rep.png"), data);
  await writeFile(
    join(root, "manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      recipeVersion: 1,
      files: { "emoji/rep.png": hash },
    }),
  );
  return { root, data, hash };
}
test("loads a checked export under its stable ID", async () => {
  const { root, data, hash } = await fixture();
  expect(await loadAssetExports(root)).toEqual([
    { id: "emoji/rep", buffer: data, hash },
  ]);
});
test("rejects corrupt exports instead of silently using stale files", async () => {
  const { root } = await fixture();
  await writeFile(join(root, "emoji/rep.png"), "changed");
  await expect(loadAssetExports(root)).rejects.toThrow("checksum mismatch");
});
test("rejects traversal in the manifest", async () => {
  const { root, hash } = await fixture();
  await writeFile(
    join(root, "manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      recipeVersion: 1,
      files: { "../secret.png": hash },
    }),
  );
  await expect(loadAssetExports(root)).rejects.toThrow();
});
test("rejects a symlink to files outside the export directory", async () => {
  const a = await fixture();
  const b = await fixture();
  await rm(join(a.root, "emoji/rep.png"));
  await symlink(join(b.root, "emoji/rep.png"), join(a.root, "emoji/rep.png"));
  await expect(loadAssetExports(a.root)).rejects.toThrow("escapes");
});
