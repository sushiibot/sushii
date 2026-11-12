import { GlobalFonts } from "@napi-rs/canvas";
import { existsSync } from "node:fs";

import { newModuleLogger } from "@/shared/infrastructure/logger";

const logger = newModuleLogger("ProofPreviewFonts");

export type FontFamily = "Body" | "BodyMedium" | "BodySemi" | "KR" | "Emoji";

export interface FontFile {
  family: FontFamily;
  /** First existing path wins. */
  paths: string[];
}

const SYSTEM = "/usr/share/fonts/truetype/noto";
const LOCAL = "/usr/local/share/fonts/noto";

/** Debian `fonts-noto-core` + `fonts-noto-color-emoji`; the rest is fetched in the Dockerfile. */
export const DEFAULT_FONT_FILES: FontFile[] = [
  { family: "Body", paths: [`${SYSTEM}/NotoSans-Regular.ttf`] },
  {
    family: "BodyMedium",
    paths: [`${LOCAL}/NotoSans-Medium.ttf`, `${SYSTEM}/NotoSans-Medium.ttf`],
  },
  {
    family: "BodySemi",
    paths: [
      `${LOCAL}/NotoSans-SemiBold.ttf`,
      `${SYSTEM}/NotoSans-SemiBold.ttf`,
    ],
  },
  { family: "KR", paths: [`${LOCAL}/NotoSansKR-Regular.otf`] },
  { family: "Emoji", paths: [`${SYSTEM}/NotoColorEmoji.ttf`] },
];

const attempted = new Set<FontFamily>();

/**
 * Registers each family at most once. Missing files are expected outside the
 * Docker image; text then falls back to whatever system fonts exist.
 */
export function registerPreviewFonts(files: FontFile[] = DEFAULT_FONT_FILES) {
  for (const file of files) {
    if (attempted.has(file.family)) {
      continue;
    }
    attempted.add(file.family);

    const path = file.paths.find((candidate) => existsSync(candidate));
    if (!path) {
      logger.debug(
        { family: file.family, paths: file.paths },
        "Preview font missing, using fallback",
      );
      continue;
    }
    if (!GlobalFonts.registerFromPath(path, file.family)) {
      logger.debug(
        { family: file.family, path },
        "Preview font failed to register, using fallback",
      );
    }
  }
}

export function font(
  family: "Body" | "BodyMedium" | "BodySemi",
  px: number,
): string {
  return `${px}px ${family}, KR, Emoji, sans-serif`;
}
