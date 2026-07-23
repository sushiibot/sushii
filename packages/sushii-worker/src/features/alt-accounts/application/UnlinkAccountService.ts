import type { Logger } from "pino";
import type { Result } from "ts-results";

import type { AltAccountRepository, RemoveMemberOutcome } from "../domain/repositories/AltAccountRepository";

export class UnlinkAccountService {
  constructor(
    private readonly altAccountRepository: AltAccountRepository,
    private readonly logger: Logger,
  ) {}

  async unlink(
    guildId: string,
    userId: string,
  ): Promise<Result<RemoveMemberOutcome, string>> {
    const result = await this.altAccountRepository.removeMember(
      guildId,
      userId,
    );

    if (result.err) {
      this.logger.error(
        { err: result.val, guildId, userId },
        "Failed to unlink account",
      );
    }

    return result;
  }
}
