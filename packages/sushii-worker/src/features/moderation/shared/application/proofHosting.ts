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
