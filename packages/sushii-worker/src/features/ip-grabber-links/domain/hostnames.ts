const URL_HOST_PATTERN = /https?:\/\/([^\s/?#<>"'`|\\]+)/gi;
const MAX_HOSTNAME_LENGTH = 253;

// Popular sites posted constantly; never IP loggers, so not worth a DNS lookup.
const SKIPPED_DOMAINS = [
  "discord.com",
  "discord.gg",
  "discord.media",
  "discordapp.com",
  "discordapp.net",
  "tenor.com",
  "giphy.com",
  "youtube.com",
  "youtu.be",
  "twitter.com",
  "x.com",
  "fxtwitter.com",
  "vxtwitter.com",
  "fixupx.com",
  "instagram.com",
  "tiktok.com",
  "reddit.com",
  "redd.it",
  "twitch.tv",
  "spotify.com",
  "google.com",
  "github.com",
  "wikipedia.org",
  "imgur.com",
  "pinterest.com",
  "weverse.io",
  "naver.com",
  "facebook.com",
  "bsky.app",
];

export function normalizeHostname(raw: string): string | null {
  // Drop userinfo and port, then trailing dots.
  const host = raw
    .slice(raw.lastIndexOf("@") + 1)
    .replace(/:\d*$/, "")
    .replace(/\.+$/, "")
    .toLowerCase();

  if (
    host.length === 0 ||
    host.length > MAX_HOSTNAME_LENGTH ||
    !host.includes(".") ||
    host.startsWith("[") ||
    /^[\d.]+$/.test(host) ||
    !/^[a-z0-9.-]+$/.test(host)
  ) {
    return null;
  }

  return host;
}

export function isSkippedHostname(hostname: string): boolean {
  return SKIPPED_DOMAINS.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  );
}

export function extractHostnames(content: string, limit = 10): string[] {
  const hostnames = new Set<string>();
  for (const match of content.matchAll(URL_HOST_PATTERN)) {
    const hostname = normalizeHostname(match[1]);
    if (hostname && !isSkippedHostname(hostname)) {
      hostnames.add(hostname);
      if (hostnames.size >= limit) {
        break;
      }
    }
  }

  return [...hostnames];
}

/** The hostname itself, then each parent down to two labels. */
export function hostnameCandidates(hostname: string): string[] {
  const labels = hostname.split(".");
  const candidates: string[] = [];
  for (let i = 0; i <= labels.length - 2; i++) {
    candidates.push(labels.slice(i).join("."));
  }

  return candidates;
}
