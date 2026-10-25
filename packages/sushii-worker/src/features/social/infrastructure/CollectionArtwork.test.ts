import { expect, test } from "bun:test";
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
  const seen = await artwork.grid(
    COLLECTIBLES.slice(0, 1),
    new Map([[COLLECTIBLES[0].id, 1]]),
  );
  const unseen = await artwork.grid(COLLECTIBLES.slice(0, 1), new Map());
  expect(seen.equals(unseen)).toBe(false);
});
