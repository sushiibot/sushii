/**
 * Lucide → PNG emoji generator.
 *
 * Usage:
 *   bun scripts/generate-emoji.ts            # generate PNGs + HTML preview
 *   bun scripts/generate-emoji.ts --screenshot  # also screenshot preview for Claude Code review
 *
 * Reads emoji-config.ts, validates all names against BotEmojiName enum,
 * fetches SVGs from lucide-static, applies Catppuccin Mocha theming,
 * renders 128px PNGs into emojis/<name>.png, writes an HTML preview,
 * and optionally screenshots it to scripts/preview-emoji.png.
 */

import { Resvg } from "@resvg/resvg-js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SCREENSHOT = process.argv.includes("--screenshot");

import { BotEmojiName } from "../src/features/bot-emojis/domain/BotEmojiName";
import { emojiConfig } from "./emoji-config";

const EMOJI_SIZE = 128;
const STROKE_WIDTH = "2.75";
// Catppuccin Mocha Surface1 — matches existing emoji background color
const BG_COLOR = "#45475a";
const BG_RADIUS = 28;
// Icon occupies ~75% of the canvas (96px), leaving 16px padding each side
const ICON_SIZE = 96;
const ICON_OFFSET = (EMOJI_SIZE - ICON_SIZE) / 2;

// Catppuccin Mocha base background for preview
const MOCHA_BASE = "#1e1e2e";
// Catppuccin Latte base background for preview
const LATTE_BASE = "#eff1f5";

const SCRIPT_DIR = import.meta.dir;
const PACKAGE_DIR = join(SCRIPT_DIR, "..");
const EMOJIS_DIR = join(PACKAGE_DIR, "emojis");
const LUCIDE_ICONS_DIR = join(
  PACKAGE_DIR,
  "node_modules",
  "lucide-static",
  "icons",
);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const validNames = new Set(BotEmojiName.options);

const invalidNames = emojiConfig
  .filter((e) => !validNames.has(e.name))
  .map((e) => e.name);

if (invalidNames.length > 0) {
  console.error(
    `❌ Invalid emoji names (not in BotEmojiName enum): ${invalidNames.join(", ")}`,
  );
  process.exit(1);
}

const missingIcons = emojiConfig.filter(
  (e) => !existsSync(join(LUCIDE_ICONS_DIR, `${e.icon}.svg`)),
);

if (missingIcons.length > 0) {
  console.error(
    `❌ Unknown Lucide icon names: ${missingIcons.map((e) => e.icon).join(", ")}`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const generatedPngs: { name: string; base64: string }[] = [];

for (const entry of emojiConfig) {
  const svgPath = join(LUCIDE_ICONS_DIR, `${entry.icon}.svg`);
  let svg = readFileSync(svgPath, "utf-8");

  // Apply theming to the inner icon SVG
  svg = svg
    .replace(/currentColor/g, entry.color)
    .replace(/stroke-width="[^"]*"/g, `stroke-width="${STROKE_WIDTH}"`);

  // Strip width/height from the inner SVG so it scales to the nested viewport
  svg = svg.replace(
    /<svg([^>]*)>/,
    (_, attrs: string) => {
      const updated = attrs
        .replace(/\s*width="[^"]*"/, "")
        .replace(/\s*height="[^"]*"/, "");
      return `<svg${updated} width="${ICON_SIZE}" height="${ICON_SIZE}">`;
    },
  );

  // Wrap icon in a canvas with rounded-rect background, icon centered
  const wrapped = `<svg xmlns="http://www.w3.org/2000/svg" width="${EMOJI_SIZE}" height="${EMOJI_SIZE}">
  <rect width="${EMOJI_SIZE}" height="${EMOJI_SIZE}" rx="${BG_RADIUS}" ry="${BG_RADIUS}" fill="${BG_COLOR}"/>
  <g transform="translate(${ICON_OFFSET}, ${ICON_OFFSET})">${svg}</g>
</svg>`;

  // Render SVG → PNG
  const resvg = new Resvg(wrapped, {
    fitTo: { mode: "width", value: EMOJI_SIZE },
  });
  const png = resvg.render();
  const pngData = png.asPng();

  const outPath = join(EMOJIS_DIR, `${entry.name}.png`);
  await Bun.write(outPath, pngData);

  const base64 = Buffer.from(pngData).toString("base64");
  generatedPngs.push({ name: entry.name, base64 });

  console.log(`✓ ${entry.name}.png  (${entry.icon}, ${entry.color})`);
}

// ---------------------------------------------------------------------------
// HTML Preview
// ---------------------------------------------------------------------------

const emojiGrid = (bg: string, label: string): string => {
  const items = generatedPngs
    .map(
      ({ name, base64 }) => `
      <div style="display:flex;flex-direction:column;align-items:center;gap:6px">
        <img src="data:image/png;base64,${base64}" width="128" height="128" alt="${name}" title="${name}" style="border-radius:8px" />
        <span style="font-family:monospace;font-size:12px;color:#cdd6f4">${name}</span>
      </div>`,
    )
    .join("");

  return `
    <div style="background:${bg};padding:24px;border-radius:12px;display:flex;flex-direction:column;gap:12px">
      <h3 style="margin:0;font-family:sans-serif;font-size:14px;color:#cdd6f4;text-transform:uppercase;letter-spacing:.1em">${label}</h3>
      <div style="display:flex;flex-wrap:wrap;gap:16px">${items}</div>
    </div>`;
};

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Emoji Preview</title>
  <style>
    body { margin: 0; background: #11111b; padding: 32px; }
    .panels { display: flex; gap: 24px; flex-wrap: wrap; }
  </style>
</head>
<body>
  <h1 style="font-family:sans-serif;color:#cdd6f4;margin-bottom:24px">Emoji Preview</h1>
  <div class="panels">
    ${emojiGrid(MOCHA_BASE, "Catppuccin Mocha (dark)")}
    ${emojiGrid(LATTE_BASE, "Catppuccin Latte (light)")}
  </div>
</body>
</html>`;

const previewPath = join(SCRIPT_DIR, "preview-emoji.html");
await Bun.write(previewPath, html);
console.log(`\n✓ Preview written to scripts/preview-emoji.html`);
console.log(`  Generated ${generatedPngs.length} emoji(s).`);

// ---------------------------------------------------------------------------
// Screenshot (for Claude Code visual review)
// ---------------------------------------------------------------------------

if (SCREENSHOT) {
  const { chromium } = await import("playwright");

  const CHROMIUM_PATH =
    process.env.CHROMIUM_PATH ??
    `${process.env.HOME}/.cache/ms-playwright/chromium-1194/chrome-linux/chrome`;

  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH });
  const page = await browser.newPage();

  await page.goto(`file://${previewPath}`);
  await page.waitForLoadState("domcontentloaded");

  const screenshotPath = join(SCRIPT_DIR, "preview-emoji.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await browser.close();

  console.log(`✓ Screenshot saved to scripts/preview-emoji.png`);
  console.log(`  Open with: claude code Read tool → scripts/preview-emoji.png`);
}
