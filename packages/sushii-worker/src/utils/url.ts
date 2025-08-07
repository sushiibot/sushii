import path from "path";

/**
 * Extracts a clean filename from a URL by removing query parameters and fragments.
 * Particularly useful for Discord CDN URLs that include authentication parameters.
 *
 * @param url - The URL to extract the filename from
 * @returns The clean filename without query parameters
 *
 * @example
 * getCleanFilename("https://cdn.discord.com/attachments/123/456/IMG_5169.png?ex=6895852c&is=689433ac")
 * // Returns: "IMG_5169.png"
 */
export function getCleanFilename(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    return path.basename(pathname);
  } catch {
    // Fallback for invalid URLs - try to extract filename before query params
    const cleanUrl = url.split("?")[0];
    return path.basename(cleanUrl);
  }
}
