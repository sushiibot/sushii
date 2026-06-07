import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import type { Logger } from "pino";

import { contentTypeFromFilename, extFromFilename } from "../utils/imageUtils";
import type { ScamImageMetrics } from "./metrics/ScamImageMetrics";

export interface StoreOpts {
  buffer: Buffer;
  phash: bigint;
  closestDistance: number | undefined;
  trigger: "hash_check" | "candidate_review" | "hash_add";
  userId: string;
  guildId: string | undefined;
  filename: string;
}

export class ScamImageStore {
  private readonly s3: S3Client;
  private metrics?: ScamImageMetrics;

  constructor(
    endpoint: string,
    private readonly bucket: string,
    accessKeyId: string,
    secretAccessKey: string,
    private readonly logger: Logger,
    metrics?: ScamImageMetrics,
  ) {
    this.s3 = new S3Client({
      endpoint,
      region: "auto",
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
    this.metrics = metrics;
  }

  setMetrics(metrics: ScamImageMetrics): void {
    this.metrics = metrics;
  }

  async store(opts: StoreOpts): Promise<string | null> {
    const { buffer, phash, closestDistance, trigger, userId, guildId, filename } = opts;

    const uuid = crypto.randomUUID();
    const ext = extFromFilename(filename);
    const key = `scam-images/${uuid}.${ext}`;
    const contentType = contentTypeFromFilename(filename);

    const metadata: Record<string, string> = {
      phash: phash.toString(16).padStart(16, "0"),
      trigger,
      "user-id": userId,
    };

    if (guildId) {
      metadata["guild-id"] = guildId;
    }

    if (closestDistance !== undefined) {
      metadata["closest-distance"] = String(closestDistance);
    }

    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType,
          Metadata: metadata,
        }),
      );
      return key;
    } catch (err) {
      this.metrics?.uploadFailureCounter.add(1, { trigger });
      this.logger.warn({ err, key }, "ScamImageStore upload failed");
      return null;
    }
  }
}
