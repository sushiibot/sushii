import {
  type ProofDownload,
  type ProofUpload,
  downloadProofFile,
  isDownloadableProofUrl,
} from "./proofHosting";

/** A file someone gave as proof: a modal upload, a command option or a message attachment. */
export interface ProofFileSource {
  url: string;
  name: string;
  size: number;
  contentType: string | null;
}

/** Files are buffered in memory before the re-upload, so this caps each one. */
export const PROOF_FILE_MAX_BYTES = 25 * 1024 * 1024;
export const PROOF_FILE_DOWNLOAD_TIMEOUT_MS = 10_000;

/** The largest file sushii re-uploads, given what the bot may upload in this guild. */
export function proofFileMaxBytes(uploadLimit: number): number {
  return Math.min(uploadLimit, PROOF_FILE_MAX_BYTES);
}

/** A Discord-hosted file, named as it was uploaded rather than after its URL. */
export async function downloadProofSource(
  file: ProofFileSource,
  maxBytes: number,
): Promise<ProofDownload | { kind: "not_downloadable" }> {
  if (!isDownloadableProofUrl(file.url)) {
    return { kind: "not_downloadable" };
  }
  if (file.size > maxBytes) {
    return { kind: "too_large", bytes: file.size };
  }

  const download = await downloadProofFile(file.url, {
    signal: AbortSignal.timeout(PROOF_FILE_DOWNLOAD_TIMEOUT_MS),
    maxBytes,
  });
  if (download.kind !== "ok") {
    return download;
  }

  const upload: ProofUpload = {
    name: file.name || download.file.name,
    data: download.file.data,
    contentType: file.contentType ?? download.file.contentType,
  };
  return { kind: "ok", file: upload };
}
