// 60s comfortably exceeds worst-case audit-log gateway delivery delay (~1–30s).
const SUPPRESSION_TTL_MS = 60_000;

/**
 * In-memory set tracking active softban operations (guildId:userId).
 * Prevents spurious BanRemove audit log cases created by the immediate unban.
 */
export class SoftbanSuppressionSet {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  private key(guildId: string, userId: string): string {
    return `${guildId}:${userId}`;
  }

  suppress(guildId: string, userId: string): void {
    const k = this.key(guildId, userId);

    // Clear existing timer if already suppressed (resets the TTL)
    const existing = this.timers.get(k);
    if (existing !== undefined) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.timers.delete(k);
    }, SUPPRESSION_TTL_MS);
    timer.unref();

    this.timers.set(k, timer);
  }

  isSuppressed(guildId: string, userId: string): boolean {
    return this.timers.has(this.key(guildId, userId));
  }

  release(guildId: string, userId: string): void {
    const k = this.key(guildId, userId);
    const timer = this.timers.get(k);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(k);
    }
  }
}
