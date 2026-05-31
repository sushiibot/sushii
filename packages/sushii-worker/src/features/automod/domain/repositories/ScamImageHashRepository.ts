export interface ScamImageHash {
  id: number;
  hash: bigint; // unsigned 64-bit dHash (converted from DB signed representation)
  label: string | null;
  addedAt: Date;
}

export interface ScamImageHashRepository {
  findClosest(
    hashValue: bigint,
  ): Promise<{ entry: ScamImageHash; distance: number } | null>;
  add(hashValue: bigint, label?: string): Promise<number>;
  delete(id: number): Promise<boolean>;
  list(): Promise<ScamImageHash[]>;
}
