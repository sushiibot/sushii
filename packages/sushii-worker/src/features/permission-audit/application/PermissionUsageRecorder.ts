import type { Logger } from "pino";

import type {
  PermissionName,
  PermissionUsage,
} from "../domain/PermissionUsage";
import type { PermissionUsageRepository } from "../domain/PermissionUsageRepository";
import type { AuditLogEntryInput } from "../domain/detectors/AuditLogUsageDetector";
import type { AuditLogUsageDetector } from "../domain/detectors/AuditLogUsageDetector";
import type { MessageInput } from "../domain/detectors/MessageUsageDetector";
import type { MessageUsageDetector } from "../domain/detectors/MessageUsageDetector";

export interface SushiiActionUsage {
  guildId: string;
  userId: string;
  permission: PermissionName;
  channelId: string | null;
}

/**
 * Best-effort: recording usage must never fail the action being recorded, so
 * every public method logs and swallows persistence errors.
 */
export class PermissionUsageRecorder {
  private readonly trackingStartedGuilds = new Set<string>();

  constructor(
    private readonly repository: PermissionUsageRepository,
    private readonly auditLogDetector: AuditLogUsageDetector,
    private readonly messageDetector: MessageUsageDetector,
    private readonly logger: Logger,
  ) {}

  async recordAuditLogEntry(entry: AuditLogEntryInput): Promise<void> {
    await this.safely(
      { guildId: entry.guildId, action: entry.action },
      async () => {
        await this.markTrackingStarted(entry.guildId, entry.occurredAt);
        await this.repository.record(this.auditLogDetector.detect(entry));
      },
    );
  }

  /** Unlike live recording this throws, so the backfill can release its claim. */
  async recordBackfill(entries: readonly AuditLogEntryInput[]): Promise<void> {
    await this.repository.record(
      entries.flatMap((entry) => this.auditLogDetector.detect(entry)),
    );
  }

  async recordMessage(message: MessageInput): Promise<void> {
    const usages = this.messageDetector.detect(message);
    if (usages.length === 0) {
      return;
    }

    await this.safely({ guildId: message.guildId }, () =>
      this.repository.record(usages),
    );
  }

  async recordSushiiAction(action: SushiiActionUsage): Promise<void> {
    const usage: PermissionUsage = {
      ...action,
      source: "sushii_action",
      occurredAt: new Date(),
    };

    await this.safely(
      { guildId: action.guildId, permission: action.permission },
      () => this.repository.record([usage]),
    );
  }

  /** Also clears the in-memory tracking start, so a re-added guild starts fresh. */
  async forgetGuild(guildId: string): Promise<void> {
    this.trackingStartedGuilds.delete(guildId);
    await this.repository.deleteGuild(guildId);
  }

  private async markTrackingStarted(guildId: string, at: Date): Promise<void> {
    if (this.trackingStartedGuilds.has(guildId)) {
      return;
    }

    await this.repository.ensureTrackingStarted(guildId, at);
    this.trackingStartedGuilds.add(guildId);
  }

  private async safely(
    context: Record<string, unknown>,
    operation: () => Promise<void>,
  ): Promise<void> {
    try {
      await operation();
    } catch (err) {
      this.logger.error(
        { err, ...context },
        "Failed to record permission usage",
      );
    }
  }
}
