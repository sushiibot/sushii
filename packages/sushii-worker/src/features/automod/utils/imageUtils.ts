export function filenameFromUrl(url: string, fallback = "image.bin"): string {
  return url.split("?")[0].split("/").pop() || fallback;
}

export function extFromFilename(filename: string): string {
  const raw = filename.split(".").pop()?.toLowerCase() ?? "";
  switch (raw) {
    case "jpg":
    case "jpeg":
      return "jpg";
    case "gif":
      return "gif";
    case "webp":
      return "webp";
    case "png":
      return "png";
    default:
      return "bin";
  }
}

export function contentTypeFromFilename(filename: string): string {
  const ext = extFromFilename(filename);
  switch (ext) {
    case "jpg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}
