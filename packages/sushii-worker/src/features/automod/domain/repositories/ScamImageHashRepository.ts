export interface ScamImageHash {
  id: number;
  phash: bigint | null; // unsigned 64-bit pHash (DCT-based); null for legacy entries
  label: string | null;
  s3Key: string | null;
  addedAt: Date;
}

export interface ScamImageHashRepository {
  findClosest(
    phash: bigint,
  ): Promise<{ entry: ScamImageHash; phashDistance: number } | null>;
  add(phash: bigint, label?: string, s3Key?: string): Promise<number>;
  delete(id: number): Promise<boolean>;
  list(): Promise<ScamImageHash[]>;
}
