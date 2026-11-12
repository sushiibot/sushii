import { newModuleLogger } from "@/shared/infrastructure/logger";

import type { PreviewAuthor } from "./types";

const logger = newModuleLogger("ProofPreviewAvatars");

interface AvatarUrlOptions {
  size: 64;
  extension: "png";
  forceStatic: true;
}

/** The `client.rest.cdn` helpers the resolver needs. */
export interface AvatarCdn {
  guildMemberAvatar(
    guildId: string,
    userId: string,
    avatarHash: string,
    options: AvatarUrlOptions,
  ): string;
  avatar(id: string, avatarHash: string, options: AvatarUrlOptions): string;
  defaultAvatar(index: number): string;
}

export type FetchImage = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<Response>;

export interface AvatarResolverOptions {
  timeoutMs?: number;
  cacheSize?: number;
}

const URL_OPTIONS: AvatarUrlOptions = {
  size: 64,
  extension: "png",
  forceStatic: true,
};
/** A 64 px PNG is a few KB; anything far bigger isn't worth decoding. */
const MAX_AVATAR_BYTES = 64 * 1024;

export function defaultAvatarIndex(author: PreviewAuthor): number {
  if (author.discriminator !== "0" && /^\d+$/.test(author.discriminator)) {
    return Number(author.discriminator) % 5;
  }
  try {
    return Number((BigInt(author.id) >> 22n) % 6n);
  } catch {
    // Not a snowflake (malformed cache row); any default works.
    return 0;
  }
}

/** Background colors of Discord's six default avatars, by index. */
const DEFAULT_AVATAR_COLORS = [
  "#5865f2",
  "#757e8a",
  "#3ba55c",
  "#faa61a",
  "#ed4245",
  "#eb459f",
];

export function fallbackAvatarColor(author: PreviewAuthor): string {
  return (
    DEFAULT_AVATAR_COLORS[defaultAvatarIndex(author)] ??
    DEFAULT_AVATAR_COLORS[0]
  );
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * First letter (marks dropped, so zalgo stays inside the circle), or the
 * whole first emoji / flag; "?" for blank or symbol-only names.
 */
export function avatarInitial(name: string): string {
  const first = graphemes.segment(name.trim())[Symbol.iterator]().next();
  if (first.done) {
    return "?";
  }
  const segment: string = first.value.segment;
  if (/^[\p{L}\p{N}]/u.test(segment)) {
    return [...segment][0].toUpperCase();
  }
  if (/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(segment)) {
    return segment;
  }
  return "?";
}

class LruCache<V> {
  private readonly map = new Map<string, V>();

  constructor(private readonly max: number) {}

  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: string, value: V) {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) {
        this.map.delete(oldest);
      }
    }
  }
}

export class AvatarResolver {
  private readonly cache: LruCache<Buffer>;
  private readonly timeoutMs: number;

  constructor(
    private readonly cdn: AvatarCdn,
    private readonly fetchImage: FetchImage = fetch,
    options: AvatarResolverOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 1_500;
    this.cache = new LruCache(options.cacheSize ?? 500);
  }

  candidateUrls(guildId: string, author: PreviewAuthor): string[] {
    const urls: string[] = [];
    if (author.memberAvatarHash) {
      urls.push(
        this.cdn.guildMemberAvatar(
          guildId,
          author.id,
          author.memberAvatarHash,
          URL_OPTIONS,
        ),
      );
    }
    if (author.userAvatarHash) {
      urls.push(this.cdn.avatar(author.id, author.userAvatarHash, URL_OPTIONS));
    }
    urls.push(this.cdn.defaultAvatar(defaultAvatarIndex(author)));
    return urls;
  }

  /**
   * Avatar PNGs by author id; authors with no fetchable avatar are left out
   * so the renderer draws their initial. Never rejects.
   */
  async resolveAll(
    guildId: string,
    authors: PreviewAuthor[],
  ): Promise<Map<string, Buffer>> {
    const unique = new Map(authors.map((author) => [author.id, author]));
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve();
      }, this.timeoutMs);
    });

    try {
      const entries = await Promise.all(
        [...unique.values()].map(async (author) => {
          const avatar = await Promise.race([
            this.resolveOne(guildId, author, controller.signal),
            deadline.then(() => null),
          ]);
          return [author.id, avatar] as const;
        }),
      );
      const avatars = new Map<string, Buffer>();
      for (const [id, avatar] of entries) {
        if (avatar) {
          avatars.set(id, avatar);
        }
      }
      return avatars;
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  private async resolveOne(
    guildId: string,
    author: PreviewAuthor,
    signal: AbortSignal,
  ): Promise<Buffer | null> {
    let urls: string[];
    try {
      urls = this.candidateUrls(guildId, author);
    } catch (err) {
      // A malformed cached hash can make the CDN helper throw; draw the initial instead.
      logger.debug({ err, userId: author.id }, "Avatar url build failed");
      return null;
    }
    for (const url of urls) {
      const cached = this.cache.get(url);
      if (cached) {
        return cached;
      }
      if (signal.aborted) {
        break;
      }
      try {
        const image = await this.fetchOne(url, signal);
        if (image) {
          this.cache.set(url, image);
          return image;
        }
      } catch (err) {
        // Best effort: a stale hash or CDN hiccup falls through to the next candidate.
        logger.debug({ err, userId: author.id }, "Avatar fetch failed");
      }
    }
    return null;
  }

  private async fetchOne(
    url: string,
    signal: AbortSignal,
  ): Promise<Buffer | null> {
    const res = await this.fetchImage(url, { signal });
    if (!res.ok) {
      return null;
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_AVATAR_BYTES) {
      return null;
    }
    return bytes;
  }
}
