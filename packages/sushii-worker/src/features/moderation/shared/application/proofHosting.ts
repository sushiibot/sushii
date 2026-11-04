import { getCleanFilename } from "@/utils/url";

import { safeAttachmentName } from "../presentation/caseMedia";

export interface ProofUpload {
  name: string;
  data: Buffer;
  contentType: string | null;
}

/** The parts of a posted message that say which files it holds. */
export interface PostedFiles {
  attachments: readonly { id: string; filename: string; url: string }[];
  components: readonly unknown[];
}

interface PostedFile {
  id: string;
  filename: string;
  url: string | null;
}

/** Discord.js message → PostedFiles. */
export function postedFilesOf(message: {
  attachments: ReadonlyMap<string, { id: string; name: string; url: string }>;
  components: readonly { toJSON(): unknown }[];
}): PostedFiles {
  return {
    attachments: [...message.attachments.values()].map((a) => ({
      id: a.id,
      filename: a.name,
      url: a.url,
    })),
    components: message.components.map((c) => c.toJSON()),
  };
}

function resolvedUrl(media: {
  url?: string;
  proxy_url?: string;
}): string | null {
  if (media.url && /^https?:\/\//.test(media.url)) {
    return media.url;
  }

  return media.proxy_url ?? null;
}

function componentFiles(node: unknown, out: PostedFile[]): void {
  if (Array.isArray(node)) {
    for (const child of node) {
      componentFiles(child, out);
    }
    return;
  }
  if (!node || typeof node !== "object") {
    return;
  }

  const media = node as {
    attachment_id?: string;
    url?: string;
    proxy_url?: string;
  };
  if (media.attachment_id) {
    const url = resolvedUrl(media);
    out.push({
      id: media.attachment_id,
      filename: url ? getCleanFilename(url) : "",
      url,
    });
    return;
  }

  for (const value of Object.values(node)) {
    componentFiles(value, out);
  }
}

/**
 * Every file on a message. Discord leaves files a component references out of
 * `attachments`, so those are read from the components' media items.
 */
export function postedFiles(message: PostedFiles): PostedFile[] {
  const files: PostedFile[] = message.attachments.map((a) => ({ ...a }));
  const fromComponents: PostedFile[] = [];
  componentFiles(message.components, fromComponents);

  const seen = new Set(files.map((f) => f.id));
  for (const file of fromComponents) {
    if (!seen.has(file.id)) {
      seen.add(file.id);
      files.push(file);
    }
  }

  return files;
}

/** Names unique within the request and against files already on the message. */
export function uniqueUploadNames(
  uploads: readonly Pick<ProofUpload, "name">[],
  taken: readonly string[],
): string[] {
  const used = new Set(taken.map((name) => name.toLowerCase()));
  let counter = taken.length;

  return uploads.map((upload) => {
    const base = safeAttachmentName(upload.name);
    let name: string;
    do {
      counter += 1;
      name = `${counter}_${base}`;
    } while (used.has(name.toLowerCase()));
    used.add(name.toLowerCase());
    return name;
  });
}

/**
 * URL of each uploaded name, as Discord returned it (signed, never stripped:
 * Discord needs the old signature to refresh an expired link). null when the
 * response lacks it.
 */
export function uploadedUrls(
  message: PostedFiles,
  names: readonly string[],
  previousIds: ReadonlySet<string>,
): (string | null)[] {
  const byName = new Map<string, string>();
  for (const file of postedFiles(message)) {
    if (!previousIds.has(file.id) && file.url) {
      byName.set(file.filename.toLowerCase(), file.url);
    }
  }

  return names.map((name) => byName.get(name.toLowerCase()) ?? null);
}

/** Hosts sushii stores proof files on; anything else is left where it is. */
const DOWNLOAD_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

export function isDownloadableProofUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && DOWNLOAD_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * - `ok`: downloaded
 * - `dead`: Discord says the file is gone; retrying won't help
 * - `too_large`: over the cap; it stays where it is
 * - `transient`: timeout or other error; worth retrying later
 */
export type ProofDownload =
  | { kind: "ok"; file: ProofUpload }
  | { kind: "dead"; status: number }
  | { kind: "too_large"; bytes: number }
  | { kind: "transient"; status?: number; err?: unknown };

// 403 can come from a CDN edge or an expired signature, so it may work later.
const DEAD_STATUSES = new Set([404, 410]);

export async function downloadProofFile(
  url: string,
  options: { signal: AbortSignal; maxBytes: number },
): Promise<ProofDownload> {
  let res: Response;
  try {
    res = await fetch(url, { signal: options.signal });
  } catch (err) {
    return { kind: "transient", err };
  }

  if (!res.ok) {
    await res.body?.cancel();
    return DEAD_STATUSES.has(res.status)
      ? { kind: "dead", status: res.status }
      : { kind: "transient", status: res.status };
  }

  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > options.maxBytes) {
    await res.body?.cancel();
    return { kind: "too_large", bytes: declared };
  }

  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    const reader = res.body?.getReader();
    while (reader) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      bytes += value.length;
      if (bytes > options.maxBytes) {
        await reader.cancel();
        return { kind: "too_large", bytes };
      }
      chunks.push(value);
    }
  } catch (err) {
    return { kind: "transient", err };
  }

  return {
    kind: "ok",
    file: {
      name: getCleanFilename(url) || "file",
      data: Buffer.concat(chunks),
      contentType: res.headers.get("content-type"),
    },
  };
}

/** A set that forgets its oldest entries past a size cap. */
export class BoundedSet<T> {
  private readonly items = new Set<T>();

  constructor(private readonly max: number) {}

  has(item: T): boolean {
    return this.items.has(item);
  }

  add(item: T): void {
    this.items.delete(item);
    this.items.add(item);
    if (this.items.size > this.max) {
      const oldest = this.items.values().next().value as T;
      this.items.delete(oldest);
    }
  }
}
