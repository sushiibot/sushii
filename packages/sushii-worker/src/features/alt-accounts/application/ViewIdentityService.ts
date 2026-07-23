import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type { AltAccountRepository } from "../domain/repositories/AltAccountRepository";
import type { AltIdentityWithMembers } from "../domain/types/AltIdentityWithMembers";

export class ViewIdentityService {
  constructor(
    private readonly altAccountRepository: AltAccountRepository,
    private readonly logger: Logger,
  ) {}

  async view(
    guildId: string,
    userId: string,
  ): Promise<Result<AltIdentityWithMembers | null, string>> {
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

    return Ok(identityResult.val);
  }
}
