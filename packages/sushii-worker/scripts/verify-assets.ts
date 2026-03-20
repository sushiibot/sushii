/**
 * Verifies that every entry in asset-mapping.ts has a corresponding encrypted file.
 * Exits non-zero if any are missing.
 *
 * Usage: bun scripts/verify-assets.ts
 */

import { existsSync } from "fs";
import { join, resolve } from "path";

import { ASSET_MAPPING } from "./asset-mapping";

const OUTPUT_DIR = resolve(join(import.meta.dir, "../assets-encrypted"));

const missing: string[] = [];

for (const { name } of ASSET_MAPPING) {
  const agePath = join(OUTPUT_DIR, `${name}.png.age`);
  if (!existsSync(agePath)) {
    missing.push(`  - ${name}.png.age`);
  }
}

if (missing.length > 0) {
  console.error(
    `Error: ${missing.length} encrypted asset(s) missing from assets-encrypted/:\n`,
  );
  console.error(missing.join("\n"));
  console.error("\nRun: ASSET_KEY=<passphrase> bun scripts/encrypt-assets.ts");
  process.exit(1);
}

console.log(`✓ All ${ASSET_MAPPING.length} encrypted assets present`);
