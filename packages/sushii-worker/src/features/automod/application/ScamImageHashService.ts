import sharp from "sharp";
import type { Logger } from "pino";

import type {
  ScamImageHash,
  ScamImageHashRepository,
} from "../domain/repositories/ScamImageHashRepository";

export interface AttachmentCheckResult {
  matched: ScamImageHash | null;
  nearMissUrls: string[];
}
import type { ScamImageMetrics } from "../infrastructure/metrics/ScamImageMetrics";

export const SCAM_HASH_MATCH_THRESHOLD = 10;
export const SCAM_HASH_NEAR_MISS_THRESHOLD = 20;
export const SCAM_HASH_DEDUP_THRESHOLD = 5;

export const SCAM_IMAGE_MAX_SIZE_BYTES = 8 * 1024 * 1024; // 8MB — Discord base upload limit
export const SCAM_IMAGE_MAX_DIMENSION = 4000;
const DOWNLOAD_TIMEOUT_MS = 3000;

function dct1d(signal: Float64Array): Float64Array {
  const N = signal.length;
  const out = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    let sum = 0;
    for (let n = 0; n < N; n++) {
      sum += signal[n] * Math.cos((Math.PI / N) * (n + 0.5) * k);
    }
    out[k] = sum;
  }
  return out;
}

function dct2d(pixels: Float64Array[], size: number): Float64Array[] {
  // Apply DCT to each row
  const rowDct = pixels.map((row) => dct1d(row));
  // Apply DCT to each column
  const result: Float64Array[] = Array.from({ length: size }, () => new Float64Array(size));
  for (let col = 0; col < size; col++) {
    const column = new Float64Array(size);
    for (let row = 0; row < size; row++) {
      column[row] = rowDct[row][col];
    }
    const colDct = dct1d(column);
    for (let row = 0; row < size; row++) {
      result[row][col] = colDct[row];
    }
  }
  return result;
}

export class ScamImageHashService {
  constructor(
    private readonly repository: ScamImageHashRepository,
    private readonly logger: Logger,
    private readonly metrics: ScamImageMetrics,
  ) {}

  async computePHash(buffer: Buffer): Promise<bigint> {
    const { data } = await sharp(buffer)
      .flatten({ background: { r: 0, g: 0, b: 0 } })
      .greyscale()
      .resize(32, 32, { fit: "fill", kernel: "nearest" })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixels: Float64Array[] = Array.from({ length: 32 }, (_, row) =>
      Float64Array.from({ length: 32 }, (_, col) => data[row * 32 + col]),
    );

    const dct = dct2d(pixels, 32);

    const low: number[] = [];
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        low.push(dct[row][col]);
      }
    }

    const mean = low.reduce((a, b) => a + b, 0) / 64;

    let hash = 0n;
    for (let i = 0; i < 64; i++) {
      if (low[i] > mean) {
        hash |= 1n << BigInt(i);
      }
    }
    return hash;
  }

  async computeHash(buffer: Buffer): Promise<bigint> {
    const { data, info } = await sharp(buffer)
      .flatten({ background: { r: 0, g: 0, b: 0 } })
      .greyscale()
      .resize(9, 8, { fit: "fill", kernel: "nearest" })
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (info.channels !== 1 || data.length !== 72) {
      throw new Error(
        `Unexpected raw buffer shape: channels=${info.channels}, length=${data.length}`,
      );
    }

    let hash = 0n;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        if (data[row * 9 + col] > data[row * 9 + col + 1]) {
          hash |= 1n << BigInt(row * 8 + col);
        }
      }
    }

    return hash;
  }

  async checkAttachments(
    attachmentUrls: string[],
    guildId: string,
  ): Promise<AttachmentCheckResult> {
    const nearMissUrls: string[] = [];

    for (const url of attachmentUrls) {
      try {
        const downloadStart = Date.now();
        const buffer = await this.downloadImage(url);
        if (!buffer) {
          this.metrics.checkCounter.add(1, { outcome: "skip_size" });
          continue;
        }
        this.metrics.downloadDurationHistogram.record(Date.now() - downloadStart);

        const hashStart = Date.now();
        const [hash, phash] = await Promise.all([
          this.computeHash(buffer),
          this.computePHash(buffer),
        ]);
        this.metrics.hashDurationHistogram.record(Date.now() - hashStart);

        const closest = await this.repository.findClosest(hash, phash);

        if (closest) {
          this.metrics.nearestDistanceHistogram.record(closest.distance);
        }

        if (closest && closest.distance <= SCAM_HASH_MATCH_THRESHOLD) {
          this.metrics.checkCounter.add(1, { outcome: "match" });
          this.metrics.matchCounter.add(1);
          return { matched: closest.entry, nearMissUrls: [] };
        }

        if (closest && closest.distance <= SCAM_HASH_NEAR_MISS_THRESHOLD) {
          nearMissUrls.push(url);
        }

        this.logger.debug(
          {
            url,
            guildId,
            closestId: closest?.entry.id,
            closestDistance: closest?.distance,
            matchThreshold: SCAM_HASH_MATCH_THRESHOLD,
            nearMissThreshold: SCAM_HASH_NEAR_MISS_THRESHOLD,
          },
          "Scam image no_match",
        );
      } catch (err) {
        this.metrics.checkCounter.add(1, { outcome: "error" });
        this.logger.debug({ err, url }, "Failed to check attachment for scam image");
      }
    }

    this.metrics.checkCounter.add(1, { outcome: "no_match" });

    return { matched: null, nearMissUrls };
  }

  private async downloadImage(url: string): Promise<Buffer | null> {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });

    if (!response.ok) {
      this.logger.debug({ url, status: response.status }, "Failed to download image");
      return null;
    }

    const contentLength = response.headers.get("content-length");
    const cl = Number(contentLength);
    if (Number.isFinite(cl) && cl > SCAM_IMAGE_MAX_SIZE_BYTES) {
      this.logger.debug({ url, contentLength }, "Skipping oversized image");
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.byteLength > SCAM_IMAGE_MAX_SIZE_BYTES) {
      this.logger.debug({ url, size: buffer.byteLength }, "Skipping oversized image");
      return null;
    }

    // Check dimensions without fully decoding
    const meta = await sharp(buffer).metadata();
    if (
      (meta.width && meta.width > SCAM_IMAGE_MAX_DIMENSION) ||
      (meta.height && meta.height > SCAM_IMAGE_MAX_DIMENSION)
    ) {
      this.logger.debug(
        { url, width: meta.width, height: meta.height },
        "Skipping image with excessive dimensions",
      );
      return null;
    }

    return buffer;
  }
}
