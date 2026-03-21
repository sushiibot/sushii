/**
 * Encrypts licensed PNG assets into assets/*.png.age
 *
 * Skips assets that already have an encrypted file. To replace an asset,
 * delete the corresponding .png.age file and re-run this script.
 *
 * Usage:
 *   ASSET_KEY=<passphrase> ASSETS_ROOT=<path> bun scripts/encrypt-assets.ts
 *
 * ASSETS_ROOT defaults to ../../assets (relative to this package root)
 */

import { Encrypter } from "age-encryption";
import { readFile, writeFile } from "fs/promises";
import { join, resolve } from "path";

import { ASSET_MAPPING } from "./asset-mapping";

const ASSET_KEY = process.env.ASSET_KEY;
if (!ASSET_KEY) {
  console.error("Error: ASSET_KEY environment variable is required");
  process.exit(1);
}

const ASSETS_ROOT = resolve(
  process.env.ASSETS_ROOT ?? join(import.meta.dir, "../../../../assets"),
);
const OUTPUT_DIR = resolve(join(import.meta.dir, "../assets"));

console.log(`Assets root: ${ASSETS_ROOT}`);
console.log(`Output dir:  ${OUTPUT_DIR}`);
console.log(`Encrypting ${ASSET_MAPPING.length} assets...\n`);

let succeeded = 0;
let skipped = 0;
let failed = 0;

for (const { src, name } of ASSET_MAPPING) {
  const srcPath = join(ASSETS_ROOT, src);
  const outPath = join(OUTPUT_DIR, `${name}.png.age`);

  try {
    // Skip if already encrypted. To replace an asset, delete the .png.age file.
    const outFile = Bun.file(outPath);
    if (await outFile.exists()) {
      console.log(`  - ${name} (already exists, skipping)`);
      skipped++;
      continue;
    }

    const plaintext = await readFile(srcPath);

    const encrypter = new Encrypter();
    encrypter.setPassphrase(ASSET_KEY);
    encrypter.setScryptWorkFactor(14); // lower than default (18) for fast startup; fine for PNG icons
    const ciphertext = await encrypter.encrypt(new Uint8Array(plaintext));

    await writeFile(outPath, ciphertext);
    console.log(`  ✓ ${name} (${src})`);
    succeeded++;
  } catch (err) {
    console.error(`  ✗ ${name}: ${err instanceof Error ? err.message : err}`);
    failed++;
  }
}

console.log(`\nDone: ${succeeded} encrypted, ${skipped} skipped, ${failed} failed`);
if (failed > 0) process.exit(1);
