import type { User } from "discord.js";

import dayjs from "@/shared/domain/dayjs";

import type { FishyResult } from "../domain";
import type { FishyCollectionRepository } from "../domain/repositories/FishyCollectionRepository";

export class FishyService {
  constructor(
    private readonly collectionRepository: FishyCollectionRepository,
  ) {}

  async fishyForUser(
    invoker: User,
    target: User,
    interactionId: string,
  ): Promise<FishyResult | dayjs.Dayjs> {
    const result = await this.collectionRepository.catchFishy(
      invoker.id,
      target.id,
      interactionId,
    );
    return result instanceof Date ? dayjs.utc(result) : result;
  }
}
