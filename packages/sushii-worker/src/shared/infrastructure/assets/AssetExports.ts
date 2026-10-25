import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import { z } from "zod";

const exportIndex = z.object({
  schemaVersion: z.literal(1),
  recipeVersion: z.literal(1),
  files: z.record(
    z.string().regex(/^(emoji|collection|symbol)\/[a-z][a-z0-9_]*\.png$/),
    z.string().regex(/^[0-9a-f]{64}$/),
  ),
});

export interface AssetExport {
  id: string;
  buffer: Buffer;
  hash: string;
}

/** Reads a pinned, local export directory. Explicit configuration fails closed. */
export async function loadAssetExports(
  directory: string,
): Promise<AssetExport[]> {
  const root = await realpath(directory);
  const manifestPath = await realpath(join(root, "manifest.json"));
  if (!manifestPath.startsWith(root + sep)) {
    throw new Error("Asset manifest escapes the export directory");
  }
  const manifest = exportIndex.parse(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
  const assets: AssetExport[] = [];
  for (const [name, expectedHash] of Object.entries(manifest.files)) {
    const file = await realpath(join(root, name));
    if (!file.startsWith(root + sep)) {
      throw new Error(`Asset escapes the export directory: ${name}`);
    }
    const buffer = await readFile(file);
    if (buffer.length > 256 * 1024)
      throw new Error(`Asset exceeds 256 KiB: ${name}`);
    const hash = createHash("sha256").update(buffer).digest("hex");
    if (hash !== expectedHash)
      throw new Error(`Asset checksum mismatch: ${name}`);
    assets.push({ id: name.slice(0, -4), buffer, hash });
  }
  return assets;
}
