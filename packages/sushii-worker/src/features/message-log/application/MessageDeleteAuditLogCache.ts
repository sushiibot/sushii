const TTL_MS = 5_000;

export interface AuditExecutor {
  executorId: string;
  executorUsername: string;
}

interface PendingWait {
  resolve: (executor: AuditExecutor | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingAudit {
  executor: AuditExecutor;
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
 * Both sides use FIFO queues so multiple concurrent deletes of the same user's
 * messages in the same channel each get their own waiter resolved independently.
 *
 * Note: Discord's audit log for message deletion does not include the specific
 * message ID — only the target user and channel. The key is therefore
 * guildId:channelId:targetUserId. When multiple messages are deleted in quick
 * succession, waiters and executors are matched FIFO. Order is not guaranteed to
 * align exactly with message-to-audit-entry pairing, but the executor is usually
 * the same moderator across all entries.
 *
 * MessageLogService calls waitForExecutor() which holds the send for up to 5s.
 * MessageDeleteAuditLogHandler calls notifyExecutor() when the audit entry arrives.
 *
 * If the audit log never arrives (e.g., no audit log permission), the Promise
 * resolves with null after TTL_MS and the embed is sent without executor info.
 */
export class MessageDeleteAuditLogCache {
  // MessageDelete arrived first — FIFO queue of waiters per key.
  private readonly pendingWaits = new Map<string, PendingWait[]>();
  // Audit log arrived first — FIFO queue of pending executors per key.
  private readonly pendingAudit = new Map<string, PendingAudit[]>();

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

    // Audit log already arrived — consume the oldest queued entry immediately.
    const auditQueue = this.pendingAudit.get(k);
    if (auditQueue?.length) {
      const pending = auditQueue.shift()!;
      clearTimeout(pending.timer);
      if (auditQueue.length === 0) this.pendingAudit.delete(k);
      return Promise.resolve(pending.executor);
    }

    return new Promise((resolve) => {
      const wait = { resolve } as PendingWait;
      const timer = setTimeout(() => {
        const queue = this.pendingWaits.get(k);
        if (queue) {
          const idx = queue.indexOf(wait);
          if (idx !== -1) queue.splice(idx, 1);
          if (queue.length === 0) this.pendingWaits.delete(k);
        }
        resolve(null);
      }, TTL_MS);
      timer.unref();
      wait.timer = timer;

      const queue = this.pendingWaits.get(k) ?? [];
      queue.push(wait);
      this.pendingWaits.set(k, queue);
    });
  }

  /**
   * Called by MessageDeleteAuditLogHandler when the audit log entry arrives.
   * Returns true if a waiting MessageDelete handler was resolved, false if the
   * audit log arrived first (executor info is queued for waitForExecutor).
   */
  notifyExecutor(
    guildId: string,
    channelId: string,
    targetUserId: string,
    executor: AuditExecutor,
  ): boolean {
    const k = this.key(guildId, channelId, targetUserId);

    // Resolve the oldest pending waiter.
    const waitQueue = this.pendingWaits.get(k);
    if (waitQueue?.length) {
      const wait = waitQueue.shift()!;
      clearTimeout(wait.timer);
      if (waitQueue.length === 0) this.pendingWaits.delete(k);
      wait.resolve(executor);
      return true;
    }

    // MessageDelete hasn't arrived yet — queue executor with a TTL timer.
    const entry = { executor } as PendingAudit;
    const timer = setTimeout(() => {
      const queue = this.pendingAudit.get(k);
      if (queue) {
        const idx = queue.indexOf(entry);
        if (idx !== -1) queue.splice(idx, 1);
        if (queue.length === 0) this.pendingAudit.delete(k);
      }
    }, TTL_MS);
    timer.unref();
    entry.timer = timer;

    const queue = this.pendingAudit.get(k) ?? [];
    queue.push(entry);
    this.pendingAudit.set(k, queue);
    return false;
  }
}
