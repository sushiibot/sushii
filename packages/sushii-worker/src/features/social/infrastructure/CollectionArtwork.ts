import sharp, { type OverlayOptions } from "sharp";

import { loadAssetExports } from "@/shared/infrastructure/assets/AssetExports";

import {
  COLLECTIBLES,
  RARITY_COLORS,
  getCollectible,
} from "../domain/collection/Catalog";
import type { Collectible } from "../domain/collection/Catalog";

const escapeXml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[char] ?? char,
  );

export class CollectionArtwork {
  private exports: Promise<Map<string, Buffer>> | undefined;
  constructor(private readonly directory?: string) {}

  async load(): Promise<Map<string, Buffer>> {
    if (!this.directory) return new Map();
    if (!this.exports) {
      this.exports = loadAssetExports(this.directory)
        .then((assets) => {
          const map = new Map(assets.map((asset) => [asset.id, asset.buffer]));
          for (const item of COLLECTIBLES)
            for (const suffix of ["", "_silhouette"]) {
              if (!map.has(`collection/${item.id}${suffix}`))
                throw new Error(
                  `Missing collection artwork: ${item.id}${suffix}`,
                );
            }
          return map;
        })
        .catch((error) => {
          this.exports = undefined;
          throw error;
        });
    }
    return this.exports;
  }

  async icon(id: string, silhouette = false): Promise<Buffer | undefined> {
    getCollectible(id);
    return (await this.load()).get(
      `collection/${id}${silhouette ? "_silhouette" : ""}`,
    );
  }

  async grid(
    items: Collectible[],
    counts: ReadonlyMap<string, number>,
  ): Promise<Buffer> {
    if (!items.length || items.length > 4)
      throw new Error("Collection pages require one to four items");
    const assets = await this.load();
    const height = Math.ceil(items.length / 2) * 232;
    const tiles: string[] = [];
    const overlays: OverlayOptions[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const count = counts.get(item.id) ?? 0;
      const x = (i % 2) * 320;
      const y = Math.floor(i / 2) * 232;
      const color = `#${RARITY_COLORS[item.rarity].toString(16).padStart(6, "0")}`;
      tiles.push(`<rect x="${x + 8}" y="${y + 8}" width="304" height="216" rx="14" fill="#252a32"/>
        <text x="${x + 160}" y="${y + 162}" text-anchor="middle" fill="#f2f3f5" font-size="21">${escapeXml(item.name)}</text>
        <text x="${x + 160}" y="${y + 186}" text-anchor="middle" fill="${color}" font-size="16">${item.rarity.toUpperCase()}</text>
        <text x="${x + 160}" y="${y + 209}" text-anchor="middle" fill="#bac1cb" font-size="15">${count ? `Caught ${count.toLocaleString()} ${count === 1 ? "time" : "times"}` : "Not discovered"}</text>`);
      const icon = assets.get(
        `collection/${item.id}${count ? "" : "_silhouette"}`,
      );
      if (icon)
        overlays.push({
          input: await sharp(icon)
            .resize(112, 112, { fit: "contain", background: "#00000000" })
            .png()
            .toBuffer(),
          left: x + 104,
          top: y + 26,
        });
      else
        tiles.push(
          `<text x="${x + 160}" y="${y + 111}" text-anchor="middle" fill="#7b8491" font-size="72">?</text>`,
        );
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="${height}"><rect width="100%" height="100%" fill="#1c2027"/><g font-family="DejaVu Sans, sans-serif">${tiles.join("")}</g></svg>`;
    return sharp(Buffer.from(svg)).composite(overlays).png().toBuffer();
  }
}
