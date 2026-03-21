/**
 * Serves a live preview of all mapped assets over HTTP.
 *
 * Without ASSET_KEY: serves images directly from ASSETS_ROOT (original files)
 * With ASSET_KEY:    decrypts and serves from assets/*.png.age
 *
 * Usage:
 *   bun scripts/preview-asset-mapping.ts
 *   ASSET_KEY=<passphrase> bun scripts/preview-asset-mapping.ts
 *
 * ASSETS_ROOT defaults to ../../../../assets relative to this script.
 */

import { readFile, readdir } from "fs/promises";
import { extname, join, resolve } from "path";

import { ASSET_MAPPING } from "./asset-mapping";

const PORT = Number(process.env.PORT ?? 3456);
const ASSET_KEY = process.env.ASSET_KEY ?? null;
const ASSETS_ROOT = resolve(
  process.env.ASSETS_ROOT ?? join(import.meta.dir, "../../../../assets"),
);
const ENCRYPTED_DIR = resolve(join(import.meta.dir, "../assets"));

const MODE = ASSET_KEY ? "encrypted" : "source";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function imgSrc(src: string, name: string): string {
  return ASSET_KEY
    ? `/encrypted/${encodeURIComponent(name)}`
    : `/asset/${encodeURIComponent(src)}`;
}

const cards = ASSET_MAPPING.map(
  ({ src, name }) => `
    <div class="card">
      <img class="preview-large" src="${imgSrc(src, name)}" alt="${name}" />
      <div class="name">${name}</div>
      <div class="src">${src}</div>
      <div class="message-mock">
        <div class="mock-row">
          <img class="preview-inline" src="${imgSrc(src, name)}" alt="" />
          <span class="mock-text">Some message</span>
        </div>
        <div class="mock-row">
          <span class="mock-text">Reason:</span>
          <img class="preview-inline" src="${imgSrc(src, name)}" alt="" />
          <span class="mock-text">text here</span>
        </div>
      </div>
    </div>`,
).join("\n");

const modeBadge =
  MODE === "encrypted"
    ? `<span class="badge encrypted">encrypted assets</span>`
    : `<span class="badge source">source files</span>`;

const INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Asset Mapping Preview</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #1a1a2e;
      color: #eee;
      font-family: system-ui, sans-serif;
      padding: 24px;
    }
    h1 {
      font-size: 1.4rem;
      margin-bottom: 6px;
      color: #a8b4ff;
    }
    p.meta {
      font-size: 0.8rem;
      color: #888;
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .badge {
      font-size: 0.7rem;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 999px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .badge.encrypted { background: #2d4a22; color: #7ddb5a; }
    .badge.source    { background: #2a2a4a; color: #a8b4ff; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 16px;
    }
    .card {
      background: #16213e;
      border: 1px solid #2a2a4a;
      border-radius: 10px;
      padding: 16px 12px 12px;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
    .preview-large {
      width: 64px;
      height: 64px;
      object-fit: contain;
    }
    .name {
      font-size: 0.78rem;
      font-weight: 600;
      color: #c9d1ff;
      word-break: break-all;
    }
    .src {
      font-size: 0.6rem;
      color: #666;
      line-height: 1.3;
      word-break: break-all;
    }
    .message-mock {
      width: 100%;
      margin-top: 6px;
      padding-top: 8px;
      border-top: 1px solid #2a2a4a;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .mock-row {
      display: flex;
      align-items: center;
      gap: 3px;
      background: #0d1117;
      border-radius: 4px;
      padding: 3px 6px;
      font-size: 0.8rem;
      color: #dcddde;
      line-height: 1;
    }
    .preview-inline {
      width: 20px;
      height: 20px;
      object-fit: contain;
      flex-shrink: 0;
    }
    .mock-text {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  </style>
</head>
<body>
  <h1>Asset Mapping Preview</h1>
  <p class="meta">
    ${ASSET_MAPPING.length} icons ${modeBadge}
    &nbsp;·&nbsp; ${MODE === "encrypted" ? ENCRYPTED_DIR : ASSETS_ROOT}
  </p>
  <div class="grid">
${cards}
  </div>
</body>
</html>`;

// Cache decrypted buffers so each image request doesn't re-decrypt
const decryptedCache = new Map<string, Buffer>();

async function loadEncryptedCache(): Promise<void> {
  if (!ASSET_KEY) return;
  const { Decrypter } = await import("age-encryption");
  const files = await readdir(ENCRYPTED_DIR).catch(() => [] as string[]);
  const ageFiles = files.filter((f) => f.endsWith(".png.age"));

  await Promise.all(
    ageFiles.map(async (filename) => {
      const name = filename.replace(/\.png\.age$/, "");
      const ciphertext = await readFile(join(ENCRYPTED_DIR, filename));
      const decrypter = new Decrypter();
      decrypter.addPassphrase(ASSET_KEY!);
      const plaintext = await decrypter.decrypt(
        new Uint8Array(ciphertext),
        "uint8array",
      );
      decryptedCache.set(name, Buffer.from(plaintext));
    }),
  );
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/") {
      return new Response(INDEX_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // Serve decrypted encrypted asset by emoji name
    if (url.pathname.startsWith("/encrypted/")) {
      const name = decodeURIComponent(url.pathname.slice("/encrypted/".length));
      const buf = decryptedCache.get(name);
      if (!buf) return new Response("Not found", { status: 404 });
      return new Response(buf, { headers: { "Content-Type": "image/png" } });
    }

    // Serve original source asset by relative path
    if (url.pathname.startsWith("/asset/")) {
      const rel = decodeURIComponent(url.pathname.slice("/asset/".length));
      const abs = resolve(join(ASSETS_ROOT, rel));
      if (!abs.startsWith(ASSETS_ROOT)) {
        return new Response("Forbidden", { status: 403 });
      }
      try {
        const data = await readFile(abs);
        const mime =
          MIME[extname(abs).toLowerCase()] ?? "application/octet-stream";
        return new Response(data, { headers: { "Content-Type": mime } });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Preview server: http://localhost:${PORT}`);
console.log(`Mode:           ${MODE}`);
if (MODE === "encrypted") {
  console.log(`Assets root:    ${ASSETS_ROOT}`);
  console.log(`Decrypting assets in background...`);
} else {
  console.log(`Assets root:    ${ASSETS_ROOT}`);
}
console.log(`Press Ctrl+C to stop`);

// Load encrypted assets in the background after server is up
loadEncryptedCache().then(() => {
  if (MODE === "encrypted") {
    console.log(`Decryption complete (${decryptedCache.size} assets loaded)`);
  }
}).catch((err) => {
  console.error(`Failed to load encrypted assets:`, err);
});
