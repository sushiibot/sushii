import { sleep } from "bun";
import type { Guild } from "discord.js";
import type { Logger } from "pino";

import type { SushiiNotification } from "@/shared/infrastructure/SushiiNotificationService";

import type { SushiiUpdatesRepository } from "../domain/SushiiUpdatesRepository";
import type { SushiiUpdatesService } from "./SushiiUpdatesService";
import { canManageWebhooksIn } from "./SushiiUpdatesService";

const DEFAULT_DELAY_MS = 1000;

export interface BackfillNotifier {
  notify(guildId: string, notification: SushiiNotification): Promise<boolean>;
}

/** Follows sushii updates into existing notifications channels, once per guild. */
export class SushiiUpdatesBackfillService {
  constructor(
    private readonly repository: SushiiUpdatesRepository,
    private readonly updates: Pick<
      SushiiUpdatesService,
      "follow" | "sourceAvailable"
    >,
    private readonly notifier: BackfillNotifier,
    private readonly notice: SushiiNotification,
    private readonly logger: Logger,
    private readonly delayMs: number = DEFAULT_DELAY_MS,
  ) {}

  async run(opts: {
    getGuild(guildId: string): Guild | undefined;
    isActive(): boolean;
  }): Promise<{ followed: number }> {
    const candidates = (await this.repository.findBackfillCandidates()).filter(
      (c) => opts.getGuild(c.guildId) !== undefined,
    );
    // Claims are never released, so a broken source channel must not use them up.
    if (candidates.length === 0 || !(await this.updates.sourceAvailable())) {
      return { followed: 0 };
    }
    let followed = 0;

    for (const { guildId } of candidates) {
      // A blue/green switch mid-run hands the rest to the other slot.
      if (!opts.isActive()) {
        break;
      }
      const guild = opts.getGuild(guildId);
      if (!guild) {
        continue;
      }

      try {
        const channelId = await this.repository.claimBackfill(guildId);
        // Missing permissions are left to the follow_updates prompt; checking
        // locally avoids a 403, which counts toward Discord's invalid request limit.
        if (!channelId || !canManageWebhooksIn(guild, channelId)) {
          continue;
        }

        const result = await this.updates.follow(guild, channelId, "backfill");
        if (
          result.err &&
          result.val === "unavailable" &&
          !(await this.updates.sourceAvailable())
        ) {
          this.logger.warn(
            { guildId },
            "sushii updates channel became unavailable, stopping backfill",
          );
          break;
        }
        if (result.ok && !result.val.alreadyFollowing) {
          followed += 1;
          await this.notifier.notify(guildId, this.notice);
        }
      } catch (err) {
        this.logger.error({ err, guildId }, "sushii updates backfill failed");
      }

      await sleep(this.delayMs);
    }

    if (candidates.length > 0) {
      this.logger.info(
        { candidates: candidates.length, followed },
        "sushii updates backfill finished",
      );
    }
    return { followed };
  }
}
