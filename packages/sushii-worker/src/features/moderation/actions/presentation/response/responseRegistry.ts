import { RESPONSE_WINDOW_MS } from "../views/ModerationActionView";

export interface LiveActionResponse {
  guildId: string;
  caseIds: string[];
  messageId: string;
  markStale(): Promise<void>;
}

export interface ActionResponseRegistry {
  /** Drops the entry once the response window has passed. */
  register(entry: LiveActionResponse): void;
  unregister(entry: LiveActionResponse): void;
  /** Best effort, never throws. */
  markStale(
    guildId: string,
    caseIds: string[],
    opts?: { exceptMessageId?: string },
  ): Promise<void>;
}

/** In-memory only: after a restart, a click on the response checks staleness instead. */
export function createActionResponseRegistry(
  windowMs = RESPONSE_WINDOW_MS,
): ActionResponseRegistry {
  const entries = new Set<LiveActionResponse>();

  return {
    register(entry) {
      entries.add(entry);
      const timer = setTimeout(() => entries.delete(entry), windowMs);
      timer.unref?.();
    },
    unregister(entry) {
      entries.delete(entry);
    },
    async markStale(guildId, caseIds, opts = {}) {
      const wanted = new Set(caseIds);
      const matches = [...entries].filter(
        (entry) =>
          entry.guildId === guildId &&
          entry.messageId !== opts.exceptMessageId &&
          entry.caseIds.some((id) => wanted.has(id)),
      );
      for (const entry of matches) {
        entries.delete(entry);
      }
      await Promise.allSettled(
        matches.map((entry) => Promise.resolve().then(() => entry.markStale())),
      );
    },
  };
}

export const actionResponseRegistry = createActionResponseRegistry();
