import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type {
  AltAccountRepository,
  MultiLinkOutcome,
} from "../domain/repositories/AltAccountRepository";

export const MAX_LINKED_ACCOUNTS = 25;

export interface LinkTarget {
  id: string;
  isBot: boolean;
}

export interface LinkAccountsRequest {
  guildId: string;
  /** The two required user options. A bot here is a hard error. */
  primary: [LinkTarget, LinkTarget];
  /** Parsed out of `additional_accounts`. Bots here are dropped and reported. */
  additional: LinkTarget[];
  linkedBy: string;
  reason: string | null;
}

export interface LinkAccountsOutcome extends MultiLinkOutcome {
  /** Bot accounts dropped from `additional`, in input order. */
  skippedBotIds: string[];
}

export class LinkAccountsService {
  constructor(
    private readonly altAccountRepository: AltAccountRepository,
    private readonly logger: Logger,
  ) {}

  async link(
    request: LinkAccountsRequest,
  ): Promise<Result<LinkAccountsOutcome, string>> {
    const { guildId, primary, additional, linkedBy, reason } = request;
    const [userA, userB] = primary;

    if (userA.id === userB.id) {
      return Err("You can't link an account to itself.");
    }

    if (userA.isBot || userB.isBot) {
      return Err("Bot accounts can't be linked.");
    }

    const skippedBotIds = additional
      .filter((target) => target.isBot)
      .map((target) => target.id);

    const userIds = [
      ...new Set(
        [userA, userB, ...additional.filter((target) => !target.isBot)].map(
          (target) => target.id,
        ),
      ),
    ];

    if (userIds.length > MAX_LINKED_ACCOUNTS) {
      return Err(
        `You can't link more than ${MAX_LINKED_ACCOUNTS} accounts at once.`,
      );
    }

    const result = await this.altAccountRepository.linkMany(
      guildId,
      userIds,
      linkedBy,
      reason,
    );

    if (result.err) {
      this.logger.error(
        { err: result.val, guildId, userIds },
        "Failed to link accounts",
      );
      return result;
    }

    return Ok({ ...result.val, skippedBotIds });
  }
}
