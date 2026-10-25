const DISCORD_MEDIA_HOSTS = new Set([
  "cdn.discordapp.com",
  "media.discordapp.net",
]);
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;
const URL_RE = /https?:\/\/[^\s<>()]+/gi;
// Markdown wrappers (spoilers, bold, strikethrough) and sentence punctuation stick to pasted links.
const LEADING_WRAPPER = /^[|*_~<>()]+/;
const TRAILING_WRAPPER = /[|*_~<>().,!?]+$/;
export const MAX_IMAGES_PER_MESSAGE = 3;

export interface ImageLink {
  url: string;
  /** Host- and signature-independent: cdn/media hosts serve the same path, and the signed
   *  `ex`/`is`/`hm` params change every time a link is re-shared. */
  key: string;
}

interface RawEmbedMedia {
  proxy_url?: string | null;
}

export function discordImageLink(raw: string): ImageLink | null {
  const trimmed = raw
    .replace(LEADING_WRAPPER, "")
    .replace(TRAILING_WRAPPER, "");
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    // Not a URL: nothing to check.
    return null;
  }
  if (u.protocol !== "https:" || !DISCORD_MEDIA_HOSTS.has(u.hostname)) {
    return null;
  }
  if (!IMAGE_EXT.test(u.pathname)) {
    return null;
  }
  return { url: u.toString(), key: u.pathname };
}

/** Pasted CDN/media links plus Discord's proxied unfurl images. Never returns a third-party URL. */
export function extractImageLinks(
  content: string,
  embeds: readonly {
    image?: RawEmbedMedia | null;
    thumbnail?: RawEmbedMedia | null;
  }[] = [],
): ImageLink[] {
  const candidates = [...(content.match(URL_RE) ?? [])];
  for (const e of embeds) {
    for (const proxied of [e.image?.proxy_url, e.thumbnail?.proxy_url]) {
      if (proxied) {
        candidates.push(proxied);
      }
    }
  }
  const seen = new Set<string>();
  const out: ImageLink[] = [];
  for (const c of candidates) {
    const link = discordImageLink(c);
    if (!link || seen.has(link.key)) {
      continue;
    }
    seen.add(link.key);
    out.push(link);
    if (out.length >= MAX_IMAGES_PER_MESSAGE) {
      break;
    }
  }
  return out;
}
