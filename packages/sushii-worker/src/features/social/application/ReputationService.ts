import type { User } from "discord.js";

import dayjs from "@/shared/domain/dayjs";

import type { RepResult } from "../domain";
import type { FishyCollectionRepository } from "../domain/repositories/FishyCollectionRepository";

export class ReputationService {
  constructor(private readonly repository: FishyCollectionRepository) {}
  async repForUser(
    invoker: User,
    target: User,
  ): Promise<RepResult | dayjs.Dayjs> {
    if (invoker.id === target.id)
      throw new Error("You cannot give reputation to yourself!");
    const result = await this.repository.giveRep(invoker.id, target.id);
    return result instanceof Date ? dayjs.utc(result) : result;
  }
}
