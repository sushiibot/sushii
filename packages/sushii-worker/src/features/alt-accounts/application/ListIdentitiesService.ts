import type { Logger } from "pino";

import type { AltAccountRepository } from "../domain/repositories/AltAccountRepository";
import type { AltIdentitySummary } from "../domain/types/AltIdentityWithMembers";

export class ListIdentitiesService {
  constructor(
    private readonly altAccountRepository: AltAccountRepository,
    private readonly logger: Logger,
  ) {}

  async listPage(
    guildId: string,
    pageIndex: number,
    pageSize: number,
  ): Promise<AltIdentitySummary[]> {
    const result = await this.altAccountRepository.listIdentities(
      guildId,
      pageSize,
      pageIndex * pageSize,
    );

    if (result.err) {
      this.logger.error(
        { err: result.val, guildId, pageIndex, pageSize },
        "Failed to list alt identities",
      );
      throw new Error(`Failed to list alt identities: ${result.val}`);
    }

    return result.val;
  }

  async count(guildId: string): Promise<number> {
    const result = await this.altAccountRepository.countIdentities(guildId);

    if (result.err) {
      this.logger.error(
        { err: result.val, guildId },
        "Failed to count alt identities",
      );
      throw new Error(`Failed to count alt identities: ${result.val}`);
    }

    return result.val;
  }
}
