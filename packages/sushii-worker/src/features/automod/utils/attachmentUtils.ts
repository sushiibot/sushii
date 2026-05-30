export interface SpamAttachment {
  filename: string;
  url: string;
  contentType?: string;
}

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".bmp",
  ".apng",
]);

export function isImageAttachment(
  attachment: Pick<SpamAttachment, "filename" | "contentType">,
): boolean {
  if (attachment.contentType?.startsWith("image/")) {
    return true;
  }
  const dot = attachment.filename.lastIndexOf(".");
  if (dot === -1) {
    return false;
  }
  const ext = attachment.filename.slice(dot).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}
