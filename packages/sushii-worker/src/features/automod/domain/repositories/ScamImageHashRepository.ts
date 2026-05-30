export interface ScamImageHash {
  id: number;
  hash: bigint; // unsigned 64-bit dHash (converted from DB signed representation)
  category: string | null;
  label: string | null;
  addedAt: Date;
}

export interface ScamImageHashRepository {
  findMatch(
    hashValue: bigint,
    threshold: number,
  ): Promise<ScamImageHash | null>;
  add(hashValue: bigint, category?: string, label?: string): Promise<number>;
  delete(id: number): Promise<boolean>;
  list(): Promise<ScamImageHash[]>;
}
