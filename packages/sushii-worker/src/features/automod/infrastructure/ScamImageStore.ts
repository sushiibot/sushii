import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import type { Logger } from "pino";

import { contentTypeFromFilename, extFromFilename } from "../utils/imageUtils";

export interface StoreOpts {
  buffer: Buffer;
  dhash: bigint;
  phash: bigint;
  closestDistance: number | undefined;
  trigger: "hash_check" | "candidate_review";
  userId: string;
  guildId: string | undefined;
  filename: string;
}

export class ScamImageStore {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(
    endpoint: string,
    bucket: string,
    accessKeyId: string,
    secretAccessKey: string,
    private readonly logger: Logger,
  ) {
    this.bucket = bucket;
    this.s3 = new S3Client({
      endpoint,
      region: "auto",
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
  }

  async store(opts: StoreOpts): Promise<void> {
    const { buffer, dhash, phash, closestDistance, trigger, userId, guildId, filename } = opts;

    const dhashHex = dhash.toString(16).padStart(16, "0");
    const ext = extFromFilename(filename);
    const key = `scam-images/${dhashHex}.${ext}`;
    const contentType = contentTypeFromFilename(filename);

    const metadata: Record<string, string> = {
      dhash: dhashHex,
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
    } catch (err) {
      this.logger.warn({ err, dhash: dhashHex }, "ScamImageStore upload failed");
    }
  }
}
