import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import type { ModLogRepository } from "@/features/moderation/shared/domain/repositories/ModLogRepository";

import type { AltAccountRepository } from "../domain/repositories/AltAccountRepository";
import type { AltIdentityWithMembers } from "../domain/types/AltIdentityWithMembers";

export interface ViewIdentityResult {
  identity: AltIdentityWithMembers;
  history: ModerationCase[];
}

export class ViewIdentityService {
  constructor(
    private readonly altAccountRepository: AltAccountRepository,
    private readonly modLogRepository: ModLogRepository,
    private readonly logger: Logger,
  ) {}

  async view(
    guildId: string,
    userId: string,
  ): Promise<Result<ViewIdentityResult | null, string>> {
    const identityResult = await this.altAccountRepository.findIdentityByUserId(
      guildId,
      userId,
    );

    if (identityResult.err) {
      this.logger.error(
        { err: identityResult.val, guildId, userId },
        "Failed to fetch alt identity for view",
      );
      return Err(identityResult.val);
    }

    if (!identityResult.val) {
      return Ok(null);
    }

    const identity = identityResult.val;
    const memberIds = identity.members.map((m) => m.userId);

    const historyResult = await this.modLogRepository.findByUserIdsNotPending(
      guildId,
      memberIds,
    );

    if (historyResult.err) {
      this.logger.error(
        { err: historyResult.val, guildId, userId },
        "Failed to fetch merged history for alt identity",
      );
      return Err(historyResult.val);
    }

    return Ok({ identity, history: historyResult.val });
  }
}
