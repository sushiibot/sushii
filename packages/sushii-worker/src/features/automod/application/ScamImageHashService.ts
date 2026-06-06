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

export class ScamImageHashService {
  constructor(
    private readonly repository: ScamImageHashRepository,
    private readonly logger: Logger,
    private readonly metrics: ScamImageMetrics,
  ) {}

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
          this.metrics.checkCounter.add(1, {
            guild_id: guildId,
            outcome: "skip_size",
          });
          continue;
        }
        this.metrics.downloadDurationHistogram.record(Date.now() - downloadStart, {
          guild_id: guildId,
        });

        const hashStart = Date.now();
        const hash = await this.computeHash(buffer);
        this.metrics.hashDurationHistogram.record(Date.now() - hashStart, {
          guild_id: guildId,
        });

        const closest = await this.repository.findClosest(hash);

        if (closest) {
          this.metrics.nearestDistanceHistogram.record(closest.distance, { guild_id: guildId });
        }

        if (closest && closest.distance <= SCAM_HASH_MATCH_THRESHOLD) {
          this.metrics.checkCounter.add(1, {
            guild_id: guildId,
            outcome: "match",
          });
          this.metrics.matchCounter.add(1, { guild_id: guildId });
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
        this.metrics.checkCounter.add(1, {
          guild_id: guildId,
          outcome: "error",
        });
        this.logger.debug({ err, url }, "Failed to check attachment for scam image");
      }
    }

    this.metrics.checkCounter.add(1, {
      guild_id: guildId,
      outcome: "no_match",
    });

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
