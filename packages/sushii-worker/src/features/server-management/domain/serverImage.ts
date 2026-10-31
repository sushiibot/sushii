import { GuildFeature } from "discord.js";

export type ServerImageKind = "icon" | "banner";

/** Only feature gates Discord documents; format and size are left to Discord to reject. */
export type ServerImageError = "banner_locked" | "animated_locked";

export function checkServerImage(
  kind: ServerImageKind,
  contentType: string | null,
  guildFeatures: readonly string[],
): ServerImageError | null {
  if (kind === "banner" && !guildFeatures.includes(GuildFeature.Banner)) {
    return "banner_locked";
  }

  const isGif = contentType?.split(";")[0].trim().toLowerCase() === "image/gif";
  const animatedFeature =
    kind === "icon" ? GuildFeature.AnimatedIcon : GuildFeature.AnimatedBanner;
  if (isGif && !guildFeatures.includes(animatedFeature)) {
    return "animated_locked";
  }

  return null;
}
