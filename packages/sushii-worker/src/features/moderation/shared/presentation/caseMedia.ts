import { getCleanFilename } from "@/utils/url";

/** Formats a Media Gallery item renders. */
const MEDIA_EXTENSIONS = /\.(png|jpe?g|gif|webp|avif|mp4|mov|webm)$/i;

export const MEDIA_GALLERY_MAX_ITEMS = 10;

export function isGalleryMedia(urlOrFilename: string): boolean {
  return MEDIA_EXTENSIONS.test(getCleanFilename(urlOrFilename));
}

/**
 * Splits case attachments into gallery media and plain links. Signed CDN links
 * expire and break once opened in a browser, but Discord refreshes them inside
 * a Media Gallery, so anything a gallery can show goes there.
 */
export function splitCaseAttachments(attachments: readonly string[]): {
  media: string[];
  links: string[];
} {
  const media: string[] = [];
  const links: string[] = [];

  for (const url of attachments.filter(Boolean)) {
    if (
      /^https?:\/\//.test(url) &&
      isGalleryMedia(url) &&
      media.length < MEDIA_GALLERY_MAX_ITEMS
    ) {
      media.push(url);
    } else {
      links.push(url);
    }
  }

  return { media, links };
}

/** A name Discord stores unchanged, so `attachment://` references resolve. */
export function safeAttachmentName(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot).replace(/[^A-Za-z0-9.]/g, "") : "";
  const base = (dot >= 0 ? name.slice(0, dot) : name)
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, 64);
  return `${base || "attachment"}${ext}`;
}
