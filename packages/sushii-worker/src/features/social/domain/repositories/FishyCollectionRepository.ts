import type { FishyResult, RepResult } from "..";

export interface CollectionEntry {
  collectibleId: string;
  catchCount: number;
  firstCaughtAt: Date;
  lastCaughtAt: Date;
}
export interface FishyCollectionRepository {
  catchFishy(
    invokerId: string,
    targetId: string,
    interactionId: string,
    now?: Date,
  ): Promise<FishyResult | Date>;
  giveRep(
    invokerId: string,
    targetId: string,
    now?: Date,
  ): Promise<RepResult | Date>;
  getCollection(userId: string): Promise<CollectionEntry[]>;
}
