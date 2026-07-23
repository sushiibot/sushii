import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err } from "ts-results";

import type { AltAccountRepository, LinkOutcome } from "../domain/repositories/AltAccountRepository";

export interface LinkTarget {
  id: string;
  isBot: boolean;
}

export class LinkAccountsService {
  constructor(
    private readonly altAccountRepository: AltAccountRepository,
    private readonly logger: Logger,
  ) {}

  async link(
    guildId: string,
    userA: LinkTarget,
    userB: LinkTarget,
    linkedBy: string,
    reason: string | null,
  ): Promise<Result<LinkOutcome, string>> {
    if (userA.id === userB.id) {
      return Err("You can't link an account to itself.");
    }

    if (userA.isBot || userB.isBot) {
      return Err("Bot accounts can't be linked.");
    }

    const result = await this.altAccountRepository.link(
      guildId,
      userA.id,
      userB.id,
      linkedBy,
      reason,
    );

    if (result.err) {
      this.logger.error(
        { err: result.val, guildId, userA: userA.id, userB: userB.id },
        "Failed to link accounts",
      );
    }

    return result;
  }
}
