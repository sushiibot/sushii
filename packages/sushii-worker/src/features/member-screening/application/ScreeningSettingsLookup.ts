import type { Logger } from "pino";

import type { ActiveScreeningSettings } from "../domain/types";
import type { ScreeningActivation } from "./ScreeningActivation";

const WARN_INTERVAL_MS = 60_000;

/** Runs on every guild message, so a flag or DB outage is treated as "not screened" and warned about once a minute, not per event. */
export class ScreeningSettingsLookup {
  private lastWarnAt = -Infinity;

  constructor(
    private readonly activation: Pick<ScreeningActivation, "activeSettings">,
    private readonly logger: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  /** The guild's settings when screening is active, otherwise null. Never throws. */
  async find(guildId: string): Promise<ActiveScreeningSettings | null> {
    try {
      return await this.activation.activeSettings(guildId);
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
