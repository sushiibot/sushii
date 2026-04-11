const TTL_MS = 5_000;

export interface AuditExecutor {
  executorId: string;
  executorUsername: string;
}

interface PendingWait {
  resolve: (executor: AuditExecutor | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Bidirectional short-lived cache for correlating MessageDelete gateway events
 * with GuildAuditLogEntryCreate events. Keyed by guildId:channelId:targetUserId.
 *
 * When a moderator deletes another user's message, Discord emits both events
 * but in no guaranteed order:
 *  - MessageDelete gateway event (usually fast)
 *  - GuildAuditLogEntryCreate event (usually slower, but not always)
 *
 * MessageLogService calls waitForExecutor() which holds the send for up to 5s.
 * MessageDeleteAuditLogHandler calls notifyExecutor() when the audit entry arrives.
 *
 * If the audit log never arrives (e.g., no audit log permission), the Promise
 * resolves with null after TTL_MS and the embed is sent without executor info.
 */
export class MessageDeleteAuditLogCache {
  // MessageDelete arrived first — waiting for audit log to resolve the Promise.
  private readonly pendingWaits = new Map<string, PendingWait>();
  // Audit log arrived first — waiting for MessageDelete to pick it up.
  private readonly pendingAudit = new Map<string, AuditExecutor>();

  private key(
    guildId: string,
    channelId: string,
    targetUserId: string,
  ): string {
    return `${guildId}:${channelId}:${targetUserId}`;
  }

  /**
   * Called by MessageLogService. Returns executor info if available within TTL_MS,
   * or null if the audit log never arrives (no permissions, self-delete, etc.).
   */
  waitForExecutor(
    guildId: string,
    channelId: string,
    targetUserId: string,
  ): Promise<AuditExecutor | null> {
    const k = this.key(guildId, channelId, targetUserId);

    // Audit log already arrived — return immediately.
    const audit = this.pendingAudit.get(k);
    if (audit) {
      this.pendingAudit.delete(k);
      return Promise.resolve(audit);
    }

    // Resolve any existing wait for the same key so the first caller doesn't hang.
    const existing = this.pendingWaits.get(k);
    if (existing) {
      clearTimeout(existing.timer);
      existing.resolve(null);
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingWaits.delete(k);
        resolve(null);
      }, TTL_MS);

      // Don't keep the process alive just for this timer.
      timer.unref();

      this.pendingWaits.set(k, { resolve, timer });
    });
  }

  /**
   * Called by MessageDeleteAuditLogHandler when the audit log entry arrives.
   * Returns true if a waiting MessageDelete handler was resolved, false if the
   * audit log arrived first (executor info is stored for waitForExecutor).
   */
  notifyExecutor(
    guildId: string,
    channelId: string,
    targetUserId: string,
    executor: AuditExecutor,
  ): boolean {
    const k = this.key(guildId, channelId, targetUserId);

    const wait = this.pendingWaits.get(k);
    if (wait) {
      clearTimeout(wait.timer);
      this.pendingWaits.delete(k);
      wait.resolve(executor);
      return true;
    }

    // MessageDelete hasn't been processed yet — store for when it arrives.
    // Auto-delete after TTL to avoid leaking if MessageDelete never fires.
    this.pendingAudit.set(k, executor);
    setTimeout(() => this.pendingAudit.delete(k), TTL_MS).unref();
    return false;
  }
}
