import type { Logger } from "pino";

import type { ScreeningGuildRepository } from "../../domain/repositories/ScreeningGuildRepository";
import type { ScreeningGuildSettings } from "../../domain/types";

const WARN_INTERVAL_MS = 60_000;

/** Runs on every guild message, so a DB outage is treated as "not screened" and warned about once a minute, not per event. */
export class ScreeningSettingsLookup {
  private lastWarnAt = -Infinity;

  constructor(
    private readonly guildRepo: ScreeningGuildRepository,
    private readonly logger: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  async find(guildId: string): Promise<ScreeningGuildSettings | null> {
    try {
      return await this.guildRepo.findByGuildId(guildId);
    } catch (err) {
      const now = this.now();
      if (now - this.lastWarnAt >= WARN_INTERVAL_MS) {
        this.lastWarnAt = now;
        this.logger.warn(
          { err, guildId },
          "Screening settings lookup failed, skipping screening",
        );
      }
      return null;
    }
  }
}
