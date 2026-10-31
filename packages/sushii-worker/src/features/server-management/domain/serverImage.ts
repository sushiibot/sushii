import { GuildFeature } from "discord.js";

export type ServerImageKind = "icon" | "banner";

export type ServerImageError =
  | "not_image"
  | "too_large"
  | "banner_locked"
  | "animated_locked";

export const MAX_SERVER_IMAGE_BYTES = 10 * 1024 * 1024;

const ACCEPTED_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export function checkServerImage(
  kind: ServerImageKind,
  file: { contentType: string | null; size: number },
  guildFeatures: readonly string[],
): ServerImageError | null {
  const mimeType = file.contentType?.split(";")[0].trim().toLowerCase();
  if (!mimeType || !ACCEPTED_CONTENT_TYPES.has(mimeType)) {
    return "not_image";
  }

  if (file.size > MAX_SERVER_IMAGE_BYTES) {
    return "too_large";
  }

  if (kind === "banner" && !guildFeatures.includes(GuildFeature.Banner)) {
    return "banner_locked";
  }

  const animatedFeature =
    kind === "icon" ? GuildFeature.AnimatedIcon : GuildFeature.AnimatedBanner;
  if (mimeType === "image/gif" && !guildFeatures.includes(animatedFeature)) {
    return "animated_locked";
  }

  return null;
}
