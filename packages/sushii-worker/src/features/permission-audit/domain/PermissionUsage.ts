import type { PermissionFlagsBits } from "discord.js";

export type PermissionName = keyof typeof PermissionFlagsBits;

export type PermissionUsageSource = "audit_log" | "message" | "sushii_action";

export interface PermissionUsage {
  guildId: string;
  userId: string;
  permission: PermissionName;
  source: PermissionUsageSource;
  channelId: string | null;
  occurredAt: Date;
}

export interface PermissionUsageDetector<TEvent> {
  readonly source: PermissionUsageSource;
  /** Permissions this detector can ever report; anything outside every detector's list is "not tracked". */
  readonly observes: readonly PermissionName[];
  detect(event: TEvent): PermissionUsage[];
}

export function observedPermissions(
  detectors: readonly Pick<PermissionUsageDetector<unknown>, "observes">[],
): Set<PermissionName> {
  return new Set(detectors.flatMap((detector) => detector.observes));
}
