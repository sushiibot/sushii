import type { PermissionUsage } from "./PermissionUsage";

export interface MergedPermissionUsage {
  guildId: string;
  userId: string;
  permission: PermissionUsage["permission"];
  source: PermissionUsage["source"];
  channelId: string | null;
  firstUsedAt: Date;
  lastUsedAt: Date;
  useCount: number;
}

/** Collapses usages sharing a primary key so one upsert never touches a row twice. */
export function mergeUsages(
  usages: readonly PermissionUsage[],
): MergedPermissionUsage[] {
  const merged = new Map<string, MergedPermissionUsage>();

  for (const usage of usages) {
    const key = `${usage.guildId}:${usage.userId}:${usage.permission}:${usage.source}`;
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, {
        guildId: usage.guildId,
        userId: usage.userId,
        permission: usage.permission,
        source: usage.source,
        channelId: usage.channelId,
        firstUsedAt: usage.occurredAt,
        lastUsedAt: usage.occurredAt,
        useCount: 1,
      });
      continue;
    }

    existing.useCount += 1;
    if (usage.occurredAt < existing.firstUsedAt) {
      existing.firstUsedAt = usage.occurredAt;
    }
    if (usage.occurredAt >= existing.lastUsedAt) {
      existing.lastUsedAt = usage.occurredAt;
      existing.channelId = usage.channelId;
    }
  }

  return [...merged.values()];
}
