import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

import { COLLECTIBLES } from "../domain/collection/Catalog";
import { CollectionArtwork } from "./CollectionArtwork";

test("renders bounded pages without paid artwork", async () => {
  const artwork = new CollectionArtwork();
  const result = await artwork.grid(
    COLLECTIBLES.slice(0, 4),
    new Map([[COLLECTIBLES[0].id, 1]]),
  );
  const metadata = await sharp(result).metadata();
  expect(metadata.width).toBe(640);
  expect(metadata.height).toBe(464);
  await expect(artwork.grid([], new Map())).rejects.toThrow();
  await expect(
    artwork.grid(COLLECTIBLES.slice(0, 5), new Map()),
  ).rejects.toThrow();
});

test("discovered and undiscovered cells choose different prepared assets", async () => {
  const color = await sharp({
    create: { width: 8, height: 8, channels: 4, background: "#ff0000" },
  })
    .png()
    .toBuffer();
  const silhouette = await sharp({
    create: { width: 8, height: 8, channels: 4, background: "#808080" },
  })
    .png()
    .toBuffer();
  const artwork = new CollectionArtwork("synthetic");
  artwork["exports"] = Promise.resolve(
    new Map([
      [`collection/${COLLECTIBLES[0].id}`, color],
      [`collection/${COLLECTIBLES[0].id}_silhouette`, silhouette],
    ]),
  );
  expect(await artwork.icon(COLLECTIBLES[0].id)).toEqual(color);
  expect(await artwork.icon(COLLECTIBLES[0].id, true)).toEqual(silhouette);
  const seen = await artwork.grid(
    COLLECTIBLES.slice(0, 1),
    new Map([[COLLECTIBLES[0].id, 1]]),
  );
  const unseen = await artwork.grid(COLLECTIBLES.slice(0, 1), new Map());
  expect(seen.equals(unseen)).toBe(false);
});

test("hosted URLs use pinned revision and verified content hashes", async () => {
  const root = await mkdtemp(join(tmpdir(), "collection-hosting-"));
  try {
    await mkdir(join(root, "collection"));
    const files: Record<string, string> = {};
    for (const item of COLLECTIBLES)
      for (const suffix of ["", "_silhouette"]) {
        const bytes = Buffer.from(item.id + suffix);
        const name = `collection/${item.id}${suffix}.png`;
        files[name] = createHash("sha256").update(bytes).digest("hex");
        await writeFile(join(root, name), bytes);
      }
    await writeFile(
      join(root, "manifest.json"),
      JSON.stringify({ schemaVersion: 1, recipeVersion: 1, files }),
    );
    const revision = "a".repeat(40);
    const artwork = new CollectionArtwork(
      root,
      "https://assets.example.test",
      revision,
    );
    const id = COLLECTIBLES[0].id;
    expect(await artwork.url(id)).toBe(
      `https://assets.example.test/${revision}/${files[`collection/${id}.png`]}.png`,
    );
    expect(await artwork.url(id, true)).toBe(
      `https://assets.example.test/${revision}/${files[`collection/${id}_silhouette.png`]}.png`,
    );
    expect(await new CollectionArtwork(root).url(id)).toBeUndefined();
    expect(
      () => new CollectionArtwork(root, "http://insecure.test", revision),
    ).toThrow();
    expect(
      () => new CollectionArtwork(root, "https://assets.example.test", "main"),
    ).toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
