/**
 * Parse a Google Calendar ID from any supported input format:
 * - Share link: ?cid=<base64-encoded ID>
 * - iCal URL: /ical/<id>/public/
 * - Embed URL: ?src=<url-encoded ID>
 * - Raw ID: contains '@'
 *
 * Returns null if the input doesn't match any recognized format.
 */
export function parseCalendarId(input: string): string | null {
  const trimmed = input.trim();

  // Try to parse as URL
  let url: URL | null = null;
  try {
    url = new URL(trimmed);
  } catch {
    // Not a URL — check if raw ID (contains '@')
    if (trimmed.includes("@")) {
      return trimmed;
    }
    return null;
  }

  // Share link: ?cid=BASE64
  const cid = url.searchParams.get("cid");
  if (cid) {
    try {
      return atob(cid);
    } catch {
      return null;
    }
  }

  // Embed URL: ?src=CALENDAR_ID
  const src = url.searchParams.get("src");
  if (src) {
    return decodeURIComponent(src);
  }

  // iCal URL: /ical/<id>/public/
  const icalMatch = url.pathname.match(/\/ical\/([^/]+)\/public\//);
  if (icalMatch) {
    return decodeURIComponent(icalMatch[1]);
  }

  return null;
}
