export interface ScamImageHash {
  id: number;
  hash: bigint; // unsigned 64-bit dHash (converted from DB signed representation)
  phash: bigint | null; // unsigned 64-bit pHash (DCT-based); null for legacy entries
  label: string | null;
  addedAt: Date;
}

export interface ScamImageHashRepository {
  findClosest(
    dhash: bigint,
    phash: bigint,
  ): Promise<{ entry: ScamImageHash; distance: number } | null>;
  add(dhash: bigint, phash: bigint, label?: string): Promise<number>;
  delete(id: number): Promise<boolean>;
  list(): Promise<ScamImageHash[]>;
}
