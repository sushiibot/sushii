export type TokenKind =
  | "text"
  | "muted"
  | "mention"
  | "link"
  | "file"
  | "spoiler"
  | "warning"
  | "newline";

export interface Token {
  kind: TokenKind;
  /** For spoilers this is a same-length placeholder, never the hidden text. */
  text: string;
}

export interface Run {
  kind: TokenKind;
  text: string;
  width: number;
}

export type Measure = (kind: TokenKind, text: string) => number;

const SPOILER_PLACEHOLDER = "x";
const MAX_SPOILER_CHARS = 60;

const INLINE_PATTERN = new RegExp(
  [
    /\[(?<label>[^\]\n]+)\]\(<?(?<href>https?:\/\/[^)\s>]+)>?\)/.source,
    /<@!?(?<user>\d+)>/.source,
    /<@&(?<role>\d+)>/.source,
    /<#(?<channel>\d+)>/.source,
    /<\/(?<command>[\w-]+(?: [\w-]+){0,2}):\d+>/.source,
    /<a?:(?<emoji>\w+):\d+>/.source,
    /<t:(?<ts>-?\d+)(?::[tTdDfFR])?>/.source,
    /(?<everyone>@everyone|@here)/.source,
    /<?(?<url>https?:\/\/[^\s<>]+)>?/.source,
  ].join("|"),
  "g",
);

function stripLineMarkers(content: string): string {
  return content
    .split("\n")
    .map((line) =>
      line.replace(/^(?:>>> |> |-# |#{1,3} )/, "").replace(/^>>>$/, ""),
    )
    .join("\n");
}

function stripEmphasis(text: string): string {
  return text
    .replace(/\*\*|__|~~/g, "")
    .replace(/(^|[^\w*])\*(\S(?:[^*\n]*\S)?)\*(?![\w*])/g, "$1$2")
    .replace(/(^|[^\w])_(\S(?:[^_\n]*\S)?)_(?!\w)/g, "$1$2")
    .replace(/\\([*_~`|>#\\-])/g, "$1");
}

function pushText(tokens: Token[], text: string, kind: "text" | "muted") {
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (i > 0) {
      tokens.push({ kind: "newline", text: "" });
    }
    if (line) {
      tokens.push({ kind, text: line });
    }
  });
}

function formatTimestamp(seconds: number): string {
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) {
    return "time";
  }
  return date.toISOString().slice(0, 16).replace("T", " ");
}

const MAX_LINK_LABEL_CHARS = 60;
const MAX_HOST_CHARS = 60;

function capChars(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}

/** Keeps the end of a host, where the registrable domain is. */
function capHost(host: string): string {
  const chars = [...host];
  return chars.length <= MAX_HOST_CHARS
    ? host
    : `…${chars.slice(-(MAX_HOST_CHARS - 1)).join("")}`;
}

const BIDI_CONTROLS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/** Canvas applies bidi, so these could make a drawn link or name read as something else. */
export function stripBidiControls(text: string): string {
  return text.replace(BIDI_CONTROLS, "");
}

/** Lowercased hostname without "www.", punycoded by URL; null if unparseable. */
function hostOf(url: string): string | null {
  const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  if (!URL.canParse(withScheme)) {
    return null;
  }
  return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, "");
}

/** Labels like "discord.com/nitro" or "https://x.y" that a reader takes for the destination. */
function labelHost(label: string): string | null {
  const trimmed = label.trim();
  if (/\s/.test(trimmed) || !/\.\p{L}{2,}/u.test(trimmed)) {
    return null;
  }
  return hostOf(trimmed);
}

/** A masked link always shows where it goes; a URL-looking label for another host gets a warning. */
function maskedLinkTokens(label: string, href: string): Token[] {
  const plain = stripEmphasis(label);
  const shown = capChars(plain, MAX_LINK_LABEL_CHARS);
  const fullHost = hostOf(href) ?? href;
  const host = capHost(fullHost);
  const claimed = labelHost(plain);
  if (claimed === null) {
    return [
      { kind: "link", text: shown },
      { kind: "muted", text: ` (${host})` },
    ];
  }
  if (
    claimed === fullHost &&
    !fullHost.split(".").some((part) => part.startsWith("xn--"))
  ) {
    return [{ kind: "link", text: shown }];
  }
  return [
    { kind: "link", text: shown },
    { kind: "warning", text: ` ⚠ goes to ${host}` },
  ];
}

function tokenizeInline(text: string, tokens: Token[]) {
  let last = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index;
    if (index > last) {
      pushText(tokens, stripEmphasis(text.slice(last, index)), "text");
    }
    last = index + match[0].length;

    const {
      label,
      href,
      user,
      role,
      channel,
      command,
      emoji,
      ts,
      everyone,
      url,
    } = match.groups ?? {};
    if (label !== undefined && href !== undefined) {
      tokens.push(...maskedLinkTokens(label, href));
    } else if (user !== undefined) {
      tokens.push({ kind: "mention", text: "@user" });
    } else if (role !== undefined) {
      tokens.push({ kind: "mention", text: "@role" });
    } else if (channel !== undefined) {
      tokens.push({ kind: "mention", text: "#channel" });
    } else if (command !== undefined) {
      tokens.push({ kind: "mention", text: `/${command}` });
    } else if (emoji !== undefined) {
      tokens.push({ kind: "text", text: `:${emoji}:` });
    } else if (ts !== undefined) {
      tokens.push({ kind: "mention", text: formatTimestamp(Number(ts)) });
    } else if (everyone !== undefined) {
      tokens.push({ kind: "mention", text: everyone });
    } else if (url !== undefined) {
      const trimmed = url.replace(/[*_~]+$/, "");
      tokens.push({ kind: "link", text: trimmed });
    }
  }
  if (last < text.length) {
    pushText(tokens, stripEmphasis(text.slice(last)), "text");
  }
}

function spoilerToken(hidden: string): Token {
  // Only the length survives so the hidden text can never reach the canvas.
  const length = Math.min(
    Math.max([...hidden.trim()].length, 3),
    MAX_SPOILER_CHARS,
  );
  return { kind: "spoiler", text: SPOILER_PLACEHOLDER.repeat(length) };
}

function tokenizeCodeAndProse(text: string, tokens: Token[]) {
  const segments = text.split(/(```(?:[\w+-]*\n)?[\s\S]*?```|`[^`\n]+`)/);
  segments.forEach((segment, i) => {
    if (i % 2 === 1) {
      const inner = segment.startsWith("```")
        ? segment.replace(/^```(?:[\w+-]*\n)?/, "").replace(/```$/, "")
        : segment.slice(1, -1);
      pushText(tokens, inner.replace(/^\n+|\n+$/g, ""), "text");
      return;
    }
    tokenizeInline(segment, tokens);
  });
}

/** Longest prefix of at most `max` code points, without splitting surrogate pairs. */
function codePointPrefix(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  let count = 0;
  let end = 0;
  for (const ch of text) {
    if (count === max) {
      break;
    }
    count += 1;
    end += ch.length;
  }
  return text.slice(0, end);
}

const MAX_FILE_NAME_CHARS = 40;

/** Middle-cut keeping the extension, so a chip stays one pill on one line. */
export function shortenFileName(name: string): string {
  const chars = [...name];
  if (chars.length <= MAX_FILE_NAME_CHARS) {
    return name;
  }
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 10 ? [...name.slice(dot)] : [];
  const tailLength = ext.length + 4;
  const headLength = MAX_FILE_NAME_CHARS - tailLength - 1;
  return `${chars.slice(0, headLength).join("")}…${chars.slice(-tailLength).join("")}`;
}

/** About 6 wrapped lines of the narrowest glyphs; anything past it can't be drawn anyway. */
export const MAX_CONTENT_CHARS = 1000;

/**
 * Turns raw Discord markdown into drawable tokens. Spoilers are found on the
 * raw content first, so a code span inside a spoiler stays hidden (Discord
 * would show `||x||` inside a code span; hiding it is the safe direction).
 * Content past `maxChars` is dropped after spoiler detection, so a spoiler
 * closing beyond the cut is still hidden.
 */
export function tokenizeContent(
  content: string,
  attachmentNames: string[],
  deleted: boolean,
  maxChars: number = MAX_CONTENT_CHARS,
): Token[] {
  const tokens: Token[] = [];
  const parts = stripLineMarkers(content).split(/\|\|([\s\S]+?)\|\|/);
  let budget = maxChars;
  let truncated = false;
  for (let i = 0; i < parts.length; i++) {
    if (budget <= 0) {
      truncated = parts.slice(i).some((part) => part.length > 0);
      break;
    }
    if (i % 2 === 1) {
      const token = spoilerToken(parts[i]);
      tokens.push(token);
      budget -= token.text.length;
      continue;
    }
    const kept = codePointPrefix(parts[i], budget);
    if (kept.length < parts[i].length) {
      truncated = true;
    }
    budget -= kept.length;
    tokenizeCodeAndProse(kept, tokens);
  }

  while (tokens.length > 0 && tokens[tokens.length - 1].kind === "newline") {
    tokens.pop();
  }

  if (truncated) {
    tokens.push({ kind: "muted", text: "…" });
  }

  if (tokens.length > 0 && attachmentNames.length > 0) {
    tokens.push({ kind: "text", text: " " });
  }
  for (const name of attachmentNames) {
    // Same case-sensitive prefix Discord uses to blur the file.
    const shown = name.startsWith("SPOILER_")
      ? "spoiler file"
      : shortenFileName(name);
    tokens.push({
      kind: "file",
      text: `📎 ${shown}${deleted ? " (deleted)" : ""}`,
    });
  }

  if (tokens.length === 0) {
    tokens.push({ kind: "muted", text: "(no text content)" });
  }
  return tokens;
}

const PILL_PADDING = 6;

/** Number of leading code points of `chars` that fit in `maxWidth`; at least 1. */
function fittingPrefix(
  measure: Measure,
  kind: TokenKind,
  chars: string[],
  maxWidth: number,
): number {
  let lo = 1;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(kind, chars.slice(0, mid).join("")) <= maxWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

/**
 * Greedy word wrap. Text breaks after spaces; pills stay whole unless wider
 * than a line; anything wider than a line breaks by character. Stops as soon
 * as `maxLines` overflow and ends the last line with "…". The first line can
 * be narrower, to leave room for tag pills.
 */
export function wrapTokens(
  measure: Measure,
  tokens: Token[],
  maxWidth: number,
  maxLines: number,
  firstLineWidth: number = maxWidth,
): Run[][] {
  const lines: Run[][] = [[]];
  const lineWidth = (index: number) =>
    index === 0 ? firstLineWidth : maxWidth;
  let x = 0;
  let overflow = false;

  const newLine = () => {
    if (lines.length >= maxLines) {
      overflow = true;
      return false;
    }
    lines.push([]);
    x = 0;
    return true;
  };

  outer: for (const token of tokens) {
    if (token.kind === "newline") {
      if (!newLine()) {
        break;
      }
      continue;
    }

    const padded =
      token.kind === "mention" ||
      token.kind === "file" ||
      token.kind === "spoiler";
    const extra = padded ? PILL_PADDING : 0;
    const words =
      token.kind === "text" ||
      token.kind === "muted" ||
      token.kind === "link" ||
      token.kind === "warning" ||
      token.kind === "spoiler"
        ? token.text.split(/(?<= )/)
        : [token.text];

    for (const word of words) {
      let rest = word;
      while (rest) {
        const current = lines.length - 1;
        const available = lineWidth(current) - x;
        const width = measure(token.kind, rest) + extra;
        if (width <= available) {
          lines[current].push({ kind: token.kind, text: rest, width });
          x += width;
          break;
        }
        if (x > 0) {
          if (rest.trim() === "") {
            break;
          }
          if (!newLine()) {
            break outer;
          }
          continue;
        }
        if (padded && width <= lineWidth(current + 1)) {
          if (!newLine()) {
            break outer;
          }
          continue;
        }
        const chars = [...rest];
        const take = fittingPrefix(
          measure,
          token.kind,
          chars,
          available - extra,
        );
        const piece = chars.slice(0, take).join("");
        lines[current].push({
          kind: token.kind,
          text: piece,
          width: measure(token.kind, piece) + extra,
        });
        rest = rest.slice(piece.length);
        if (rest && !newLine()) {
          break outer;
        }
      }
    }
  }

  if (!overflow) {
    return lines;
  }

  const last = lines.length - 1;
  const lastLine = lines[last];
  const ellipsis = "…";
  const ellipsisWidth = measure("text", ellipsis);
  let used = lastLine.reduce((sum, run) => sum + run.width, 0);
  while (lastLine.length > 0 && used + ellipsisWidth > lineWidth(last)) {
    used -= lastLine.pop()?.width ?? 0;
  }
  lastLine.push({ kind: "muted", text: ellipsis, width: ellipsisWidth });
  return lines;
}
