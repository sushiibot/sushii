import {
  type Image,
  type SKRSContext2D,
  createCanvas,
  loadImage,
} from "@napi-rs/canvas";
import type { Client } from "discord.js";

import { newModuleLogger } from "@/shared/infrastructure/logger";

import {
  AvatarResolver,
  avatarInitial,
  fallbackAvatarColor,
} from "./AvatarResolver";
import { type FontFile, font, registerPreviewFonts } from "./fonts";
import { type DividerRow, type MessageRow, selectRows } from "./layout";
import {
  type Measure,
  type Run,
  type TokenKind,
  stripBidiControls,
  tokenizeContent,
  wrapTokens,
} from "./tokens";
import {
  type PreviewAuthor,
  PreviewRendererBusyError,
  type PreviewRequest,
  type SuggestionPreviewRenderer,
} from "./types";

export { PreviewRendererBusyError };

const logger = newModuleLogger("ProofPreviewRenderer");

const SCALE = 2;
const WIDTH = 560;
export const PAD = 16;
const AVATAR = 36;
const TEXT_X = PAD + AVATAR + 14;
export const TEXT_W = WIDTH - TEXT_X - PAD;
const LINE = 21;
const HEADER = 34;
const FOOTER = 30;
const DIVIDER = 30;
const APP_LINE = 18;
const MAX_LINES = 6;
const GROUP_WINDOW_MS = 7 * 60_000;
/** Logical px; 1,600 px in the 2x PNG. */
export const MAX_HEIGHT = 800;
export const PREVIEW_WIDTH = WIDTH * SCALE;

const FOOTER_TEXT =
  "Rendered by sushii from logged messages · preview only, not saved · times in UTC";

const C = {
  bg: "#313338",
  header: "#2b2d31",
  text: "#dbdee1",
  muted: "#949ba4",
  name: "#f2f3f5",
  link: "#00a8fc",
  mentionBg: "rgba(88,101,242,0.3)",
  mentionFg: "#c9cdfb",
  target: "#f23f43",
  targetBg: "rgba(242,63,67,0.06)",
  repeatBg: "rgba(242,63,67,0.35)",
  deletedBg: "rgba(242,63,67,0.18)",
  deletedFg: "#ff8a8d",
  flagBg: "rgba(240,178,50,0.18)",
  flagFg: "#f0b232",
  appBg: "#5865f2",
  divider: "#4e5058",
  fileBg: "#2b2d31",
  spoiler: "#1e1f22",
  warning: "#f0b232",
};

export type Divider =
  | { type: "context"; count: number; minutes: number }
  | { type: "earlier"; count: number; name: string }
  | { type: "cut"; count: number; earlier?: { count: number; name: string } };

export type Prepared =
  | { kind: "divider"; divider: Divider; height: number }
  | {
      kind: "message";
      row: MessageRow;
      grouped: boolean;
      lines: Run[][];
      height: number;
    };

const MAX_CONCURRENT_RENDERS = 2;
/** Fetching, queued and drawing together; beyond this callers should skip the image. */
export const MAX_PENDING_RENDERS = 8;
let pendingRenders = 0;
let activeRenders = 0;
const renderQueue: (() => void)[] = [];

export async function withRenderSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeRenders >= MAX_CONCURRENT_RENDERS) {
    // The finishing render hands its slot over directly, so no count change here.
    await new Promise<void>((resolve) => renderQueue.push(resolve));
  } else {
    activeRenders += 1;
  }
  try {
    return await fn();
  } finally {
    const next = renderQueue.shift();
    if (next) {
      next();
    } else {
      activeRenders -= 1;
    }
  }
}

function hhmm(date: Date): string {
  return date.toISOString().slice(11, 16);
}

function timeLabel(row: MessageRow): string {
  const first = hhmm(row.firstAt);
  const last = hhmm(row.lastAt);
  return first === last ? first : `${first} – ${last}`;
}

const MAX_DIVIDER_NAME_CHARS = 20;

function dividerName(name: string): string {
  const chars = [...name];
  return chars.length <= MAX_DIVIDER_NAME_CHARS
    ? name
    : `${chars.slice(0, MAX_DIVIDER_NAME_CHARS - 1).join("")}…`;
}

function sanitizeRequest(req: PreviewRequest): PreviewRequest {
  return {
    ...req,
    channelName: stripBidiControls(req.channelName),
    subtitle: stripBidiControls(req.subtitle),
    messages: req.messages.map((message) => ({
      ...message,
      content: stripBidiControls(message.content),
      attachmentNames: message.attachmentNames.map(stripBidiControls),
      triggeredBy:
        message.triggeredBy === undefined
          ? undefined
          : stripBidiControls(message.triggeredBy),
      author: {
        ...message.author,
        displayName: stripBidiControls(message.author.displayName),
      },
    })),
  };
}

export function dividerText(divider: Divider): string {
  switch (divider.type) {
    case "context": {
      const noun = divider.count === 1 ? "message" : "messages";
      const span = divider.minutes < 1 ? "<1" : String(divider.minutes);
      return `${divider.count} ${noun} from others · ${span} min`;
    }
    case "earlier":
      return `${divider.count} earlier from ${dividerName(divider.name)} not shown`;
    case "cut": {
      const noun = divider.count === 1 ? "message" : "messages";
      if (divider.earlier) {
        return `${divider.earlier.count} earlier from ${dividerName(divider.earlier.name)} + ${divider.count} more ${noun} not shown`;
      }
      return `${divider.count} earlier ${noun} not shown`;
    }
  }
}

function fontFor(kind: TokenKind): string {
  if (kind === "mention") {
    return font("BodyMedium", 15);
  }
  if (kind === "file") {
    return font("Body", 13);
  }
  return font("Body", 15);
}

function makeMeasure(ctx: SKRSContext2D): Measure {
  let current: string | null = null;
  return (kind, text) => {
    const wanted = fontFor(kind);
    if (wanted !== current) {
      ctx.font = wanted;
      current = wanted;
    }
    return ctx.measureText(text).width;
  };
}

/** Nothing past this many code points fits in a 560 px line. */
const MAX_TRUNCATE_CHARS = 200;

export function truncate(
  ctx: SKRSContext2D,
  text: string,
  maxWidth: number,
): string {
  const chars = [...text].slice(0, MAX_TRUNCATE_CHARS);
  const clipped = chars.join("").length < text.length;
  if (!clipped && ctx.measureText(text).width <= maxWidth) {
    return text;
  }
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${chars.slice(0, mid).join("")}…`).width <= maxWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return `${chars.slice(0, lo).join("")}…`;
}

function messageHeight(
  row: MessageRow,
  grouped: boolean,
  lines: number,
): number {
  if (grouped) {
    return 4 + lines * LINE + 4;
  }
  const app = row.message.triggeredBy ? APP_LINE : 0;
  return 8 + app + 28 + lines * LINE + 4;
}

const PILL_GAP = 6;

function pillWidth(ctx: SKRSContext2D, label: string): number {
  ctx.font = font("BodySemi", 10.5);
  return ctx.measureText(label).width + 10;
}

type Rows = ReturnType<typeof selectRows>;

export function tagPillsWidth(ctx: SKRSContext2D, row: MessageRow): number {
  return tagPills(row).reduce(
    (sum, tag) => sum + pillWidth(ctx, tag.label) + PILL_GAP,
    0,
  );
}

interface Wrapper {
  lines(row: MessageRow, grouped: boolean): Run[][];
}

/** Wraps each row at most once per grouped state, however many rows get cut. */
function makeWrapper(ctx: SKRSContext2D): Wrapper {
  // Separate context: pill measuring would invalidate makeMeasure's cached font.
  const measure = makeMeasure(createCanvas(1, 1).getContext("2d"));
  const cache = new Map<MessageRow, { grouped?: Run[][]; full?: Run[][] }>();
  return {
    lines(row, grouped) {
      let entry = cache.get(row);
      if (!entry) {
        entry = {};
        cache.set(row, entry);
      }
      const key = grouped ? "grouped" : "full";
      const hit = entry[key];
      if (hit) {
        return hit;
      }
      const message = row.message;
      const tokens = tokenizeContent(
        message.content,
        message.attachmentNames,
        message.deleted,
      );
      // Grouped rows draw their tag pills at the right of the first line.
      const reserved = grouped ? tagPillsWidth(ctx, row) : 0;
      const lines = wrapTokens(
        measure,
        tokens,
        TEXT_W,
        MAX_LINES,
        TEXT_W - reserved,
      );
      entry[key] = lines;
      return lines;
    },
  };
}

function prepare(
  wrapper: Wrapper,
  rows: Rows,
  cut: number,
  earlier: Extract<DividerRow, { type: "earlier" }> | null,
): { items: Prepared[]; height: number } {
  const items: Prepared[] = [];
  if (cut > 0) {
    items.push({
      kind: "divider",
      divider: {
        type: "cut",
        count: cut,
        earlier: earlier
          ? { count: earlier.count, name: earlier.name }
          : undefined,
      },
      height: DIVIDER,
    });
  } else if (earlier) {
    items.push({ kind: "divider", divider: earlier, height: DIVIDER });
  }

  let prev: MessageRow | null = null;
  for (const row of rows) {
    if (row.kind === "divider") {
      items.push({ kind: "divider", divider: row, height: DIVIDER });
      prev = null;
      continue;
    }
    const message = row.message;
    const grouped =
      prev !== null &&
      prev.message.author.id === message.author.id &&
      prev.isTarget === row.isTarget &&
      prev.count === 1 &&
      row.count === 1 &&
      !message.triggeredBy &&
      !prev.message.triggeredBy &&
      message.createdAt.getTime() - prev.lastAt.getTime() < GROUP_WINDOW_MS;
    const lines = wrapper.lines(row, grouped);
    items.push({
      kind: "message",
      row,
      grouped,
      lines,
      height: messageHeight(row, grouped, lines.length),
    });
    prev = row;
  }

  const height =
    HEADER + 8 + items.reduce((sum, item) => sum + item.height, 0) + FOOTER;
  return { items, height };
}

/**
 * Drops the oldest rows until the image fits, counting what was cut. The
 * "N earlier from X" divider is kept so the per-user count survives a cut.
 */
function fitToHeight(
  wrapper: Wrapper,
  rows: Rows,
): { items: Prepared[]; height: number } {
  const first = rows[0];
  const earlier =
    first?.kind === "divider" && first.type === "earlier" ? first : null;
  let remaining = earlier ? rows.slice(1) : rows;
  let cut = 0;
  let prepared = prepare(wrapper, remaining, cut, earlier);
  while (prepared.height > MAX_HEIGHT && remaining.length > 1) {
    let start = 1;
    // A divider left at the top would stack under the cut divider; fold it in.
    while (
      start < remaining.length - 1 &&
      remaining[start].kind === "divider"
    ) {
      start += 1;
    }
    for (const dropped of remaining.slice(0, start)) {
      cut += dropped.count;
    }
    remaining = remaining.slice(start);
    prepared = prepare(wrapper, remaining, cut, earlier);
  }
  return prepared;
}

function pill(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  label: string,
  bg: string,
  fg: string,
): number {
  const w = pillWidth(ctx, label);
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(x, y - 11, w, 15, 4);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.fillText(label, x + 5, y);
  return w;
}

function tagPills(
  row: MessageRow,
): { label: string; bg: string; fg: string }[] {
  const tags = [];
  if (row.message.deleted) {
    tags.push({ label: "DELETED", bg: C.deletedBg, fg: C.deletedFg });
  }
  if (row.message.automodFlagged) {
    tags.push({ label: "AUTOMOD FLAGGED", bg: C.flagBg, fg: C.flagFg });
  }
  return tags;
}

export interface HeaderPart {
  kind: "time" | "pill";
  label: string;
  x: number;
  width: number;
  bg: string;
  fg: string;
}

const HEADER_GAP = 6;
const TIME_GAP = 8;
/** Never squeeze a name below this, even with every pill shown. */
const MIN_NAME_WIDTH = 40;

/**
 * Lays out name, APP, time, ×N and tag pills. The name gets whatever width
 * the rest leaves, so the pills never run past the image.
 */
export function layoutHeader(
  ctx: SKRSContext2D,
  row: MessageRow,
): { name: string; parts: HeaderPart[]; right: number } {
  const author = row.message.author;
  const pills: { label: string; bg: string; fg: string }[] = [];
  if (author.isApp) {
    pills.push({ label: "APP", bg: C.appBg, fg: "#fff" });
  }
  const time = timeLabel(row);
  const after: { label: string; bg: string; fg: string }[] = [];
  if (row.count > 1) {
    after.push({ label: `×${row.count}`, bg: C.repeatBg, fg: "#fff" });
  }
  after.push(...tagPills(row));

  ctx.font = font("Body", 11.5);
  const timeWidth = ctx.measureText(time).width;
  const pillsWidth = [...pills, ...after].reduce(
    (sum, p) => sum + pillWidth(ctx, p.label) + HEADER_GAP,
    0,
  );
  const restWidth = HEADER_GAP + pillsWidth + timeWidth + TIME_GAP;
  const maxRight = WIDTH - PAD;

  ctx.font = font("BodyMedium", 15);
  const nameBudget = Math.max(
    MIN_NAME_WIDTH,
    Math.min(200, maxRight - TEXT_X - restWidth),
  );
  const name = truncate(ctx, author.displayName, nameBudget);
  let x = TEXT_X + ctx.measureText(name).width + HEADER_GAP;

  const parts: HeaderPart[] = [];
  const addPill = (p: { label: string; bg: string; fg: string }) => {
    const width = pillWidth(ctx, p.label);
    parts.push({ kind: "pill", x, width, ...p });
    x += width + HEADER_GAP;
  };
  pills.forEach(addPill);
  parts.push({
    kind: "time",
    label: time,
    x,
    width: timeWidth,
    bg: "",
    fg: C.muted,
  });
  x += timeWidth + TIME_GAP;
  after.forEach(addPill);
  const last = parts[parts.length - 1];
  return { name, parts, right: last.x + last.width };
}

function drawDivider(ctx: SKRSContext2D, y: number, divider: Divider) {
  ctx.font = font("Body", 12);
  const text = truncate(ctx, dividerText(divider), WIDTH - PAD * 2 - 40);
  const tw = ctx.measureText(text).width;
  const cy = y + 15;
  ctx.strokeStyle = C.divider;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(PAD, cy);
  ctx.lineTo(WIDTH / 2 - tw / 2 - 10, cy);
  ctx.moveTo(WIDTH / 2 + tw / 2 + 10, cy);
  ctx.lineTo(WIDTH - PAD, cy);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = C.muted;
  ctx.fillText(text, WIDTH / 2 - tw / 2, cy + 4);
}

function drawAvatar(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  image: Image | undefined,
  author: PreviewAuthor,
) {
  const r = AVATAR / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + r, y + r, r, 0, Math.PI * 2);
  ctx.closePath();
  if (image) {
    ctx.clip();
    ctx.drawImage(image, x, y, AVATAR, AVATAR);
  } else {
    ctx.fillStyle = fallbackAvatarColor(author);
    ctx.fill();
    ctx.clip();
    ctx.font = font("BodySemi", 16);
    ctx.fillStyle = "#fff";
    const initial = avatarInitial(author.displayName);
    ctx.fillText(
      initial,
      x + r - ctx.measureText(initial).width / 2,
      y + r + 6,
    );
  }
  ctx.restore();
}

function drawRuns(ctx: SKRSContext2D, lines: Run[][], startY: number): number {
  let lineY = startY;
  for (const line of lines) {
    let x = TEXT_X;
    for (const run of line) {
      ctx.font = fontFor(run.kind);
      switch (run.kind) {
        case "file":
          ctx.fillStyle = C.fileBg;
          ctx.beginPath();
          ctx.roundRect(x, lineY - 15, run.width, 20, 4);
          ctx.fill();
          ctx.fillStyle = C.muted;
          ctx.fillText(run.text, x + 3, lineY - 1);
          break;
        case "mention":
          ctx.fillStyle = C.mentionBg;
          ctx.beginPath();
          ctx.roundRect(x, lineY - 15, run.width, 20, 3);
          ctx.fill();
          ctx.fillStyle = C.mentionFg;
          ctx.fillText(run.text, x + 3, lineY);
          break;
        case "spoiler":
          ctx.fillStyle = C.spoiler;
          ctx.beginPath();
          ctx.roundRect(x, lineY - 15, run.width, 20, 3);
          ctx.fill();
          break;
        default:
          ctx.fillStyle =
            run.kind === "link"
              ? C.link
              : run.kind === "warning"
                ? C.warning
                : run.kind === "muted"
                  ? C.muted
                  : C.text;
          ctx.fillText(run.text, x, lineY);
      }
      x += run.width;
    }
    lineY += LINE;
  }
  return lineY;
}

function drawMessage(
  ctx: SKRSContext2D,
  top: number,
  item: Extract<Prepared, { kind: "message" }>,
  avatars: Map<string, Image>,
) {
  const { row, grouped, lines, height } = item;
  const message = row.message;
  const author = message.author;
  let y = grouped ? top : top + 8;
  const bandHeight = grouped ? height : height - 8;

  // Clipping keeps stacked combining marks (zalgo) inside the row's own band.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, top, WIDTH, height);
  ctx.clip();
  ctx.globalAlpha = row.isTarget ? 1 : 0.62;
  if (row.isTarget) {
    ctx.fillStyle = C.targetBg;
    ctx.fillRect(0, y - 4, WIDTH, bandHeight + 4);
    ctx.fillStyle = C.target;
    ctx.fillRect(0, y - 4, 3, bandHeight + 4);
  }

  if (grouped) {
    const lineY = y + 16;
    ctx.font = font("Body", 10.5);
    ctx.fillStyle = C.muted;
    ctx.fillText(hhmm(row.firstAt), PAD + 2, lineY + 2);
    let x = WIDTH - PAD;
    for (const tag of tagPills(row).reverse()) {
      x -= pillWidth(ctx, tag.label);
      pill(ctx, x, lineY + 1, tag.label, tag.bg, tag.fg);
      x -= PILL_GAP;
    }
    drawRuns(ctx, lines, lineY + 4);
    ctx.restore();
    return;
  }

  if (message.triggeredBy) {
    const lineY = y + 16;
    const cx = PAD + AVATAR / 2;
    ctx.strokeStyle = C.muted;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, lineY + 8);
    ctx.lineTo(cx, lineY - 6);
    ctx.arcTo(cx, lineY - 10, cx + 4, lineY - 10, 4);
    ctx.lineTo(TEXT_X - 8, lineY - 10);
    ctx.stroke();
    ctx.font = font("Body", 12.5);
    ctx.fillStyle = C.muted;
    ctx.fillText(
      truncate(ctx, `triggered by ${message.triggeredBy}`, TEXT_W),
      TEXT_X - 2,
      lineY - 6,
    );
    y += APP_LINE;
  }

  drawAvatar(ctx, PAD, y, avatars.get(author.id), author);

  let lineY = y + 16;
  const header = layoutHeader(ctx, row);
  ctx.font = font("BodyMedium", 15);
  ctx.fillStyle = C.name;
  ctx.fillText(header.name, TEXT_X, lineY);
  for (const part of header.parts) {
    if (part.kind === "time") {
      ctx.font = font("Body", 11.5);
      ctx.fillStyle = C.muted;
      ctx.fillText(part.label, part.x, lineY);
    } else {
      pill(ctx, part.x, lineY - 1, part.label, part.bg, part.fg);
    }
  }
  lineY += LINE + 2;

  drawRuns(ctx, lines, lineY);
  ctx.restore();
}

async function decodeAvatars(
  buffers: Map<string, Buffer>,
): Promise<Map<string, Image>> {
  const images = new Map<string, Image>();
  await Promise.all(
    [...buffers].map(async ([id, buffer]) => {
      try {
        images.set(id, await loadImage(buffer));
      } catch (err) {
        // Undecodable avatar: draw the initial instead of failing the preview.
        logger.debug({ err, userId: id }, "Avatar decode failed");
      }
    }),
  );
  return images;
}

/** Row selection, wrapping and height fitting, without drawing. */
export function planPreview(req: PreviewRequest): {
  items: Prepared[];
  height: number;
} {
  const probe = createCanvas(1, 1).getContext("2d");
  return fitToHeight(makeWrapper(probe), selectRows(sanitizeRequest(req)));
}

export interface CanvasPreviewRendererOptions {
  fontFiles?: FontFile[];
}

export class CanvasPreviewRenderer implements SuggestionPreviewRenderer {
  constructor(
    private readonly avatars: AvatarResolver,
    private readonly options: CanvasPreviewRendererOptions = {},
  ) {}

  async render(
    req: PreviewRequest,
  ): Promise<{ png: Buffer; width: number; height: number }> {
    if (pendingRenders >= MAX_PENDING_RENDERS) {
      throw new PreviewRendererBusyError();
    }
    pendingRenders += 1;
    try {
      return await this.renderNow(req);
    } finally {
      pendingRenders -= 1;
    }
  }

  private async renderNow(
    req: PreviewRequest,
  ): Promise<{ png: Buffer; width: number; height: number }> {
    registerPreviewFonts(this.options.fontFiles);

    req = sanitizeRequest(req);
    const rows = selectRows(req);
    const authors = rows.flatMap((row) =>
      row.kind === "message" ? [row.message.author] : [],
    );
    const avatarBuffers = await this.avatars.resolveAll(req.guildId, authors);

    return withRenderSlot(async () => {
      const avatars = await decodeAvatars(avatarBuffers);
      const probe = createCanvas(1, 1).getContext("2d");
      const { items, height } = fitToHeight(makeWrapper(probe), rows);

      const canvas = createCanvas(WIDTH * SCALE, height * SCALE);
      const ctx = canvas.getContext("2d");
      ctx.scale(SCALE, SCALE);
      ctx.textBaseline = "alphabetic";

      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, WIDTH, height);
      ctx.fillStyle = C.header;
      ctx.fillRect(0, 0, WIDTH, HEADER);
      ctx.font = font("BodySemi", 14);
      ctx.fillStyle = C.name;
      const channel = truncate(ctx, `# ${req.channelName}`, 220);
      ctx.fillText(channel, PAD, 22);
      const channelWidth = ctx.measureText(channel).width;
      ctx.font = font("Body", 12.5);
      ctx.fillStyle = C.muted;
      ctx.fillText(
        truncate(ctx, req.subtitle, WIDTH - PAD * 2 - channelWidth - 10),
        PAD + channelWidth + 10,
        22,
      );

      let y = HEADER + 8;
      for (const item of items) {
        if (item.kind === "divider") {
          drawDivider(ctx, y, item.divider);
        } else {
          drawMessage(ctx, y, item, avatars);
        }
        y += item.height;
      }

      ctx.fillStyle = C.header;
      ctx.fillRect(0, height - FOOTER, WIDTH, FOOTER);
      ctx.font = font("Body", 11.5);
      ctx.fillStyle = C.muted;
      ctx.fillText(
        truncate(ctx, FOOTER_TEXT, WIDTH - PAD * 2),
        PAD,
        height - 11,
      );

      const png = await canvas.encode("png");
      return { png, width: WIDTH * SCALE, height: height * SCALE };
    });
  }
}

export function createSuggestionPreviewRenderer(
  client: Client,
): SuggestionPreviewRenderer {
  return new CanvasPreviewRenderer(new AvatarResolver(client.rest.cdn));
}
