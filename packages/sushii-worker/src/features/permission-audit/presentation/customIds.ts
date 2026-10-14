/**
 * Collector-scoped IDs: the audit view owns one collector on its own message,
 * so these never need to survive a restart. The prefix must not be claimed by
 * any globally routed button handler.
 */
export const PERMISSION_AUDIT_CUSTOM_IDS = {
  tabOverview: "permaudit_tab_overview",
  tabRoles: "permaudit_tab_roles",
  tabUnused: "permaudit_tab_unused",
  tabChannels: "permaudit_tab_channels",
  /** Prefix only: the live ID appends the finding's index. */
  fixPrefix: "permaudit_fix:",
  confirm: "permaudit_confirm",
  cancel: "permaudit_cancel",
  back: "permaudit_back",
} as const;

export function fixCustomId(findingIndex: number): string {
  return `${PERMISSION_AUDIT_CUSTOM_IDS.fixPrefix}${findingIndex}`;
}

export function parseFixCustomId(customId: string): number | null {
  if (!customId.startsWith(PERMISSION_AUDIT_CUSTOM_IDS.fixPrefix)) {
    return null;
  }
  const index = Number(
    customId.slice(PERMISSION_AUDIT_CUSTOM_IDS.fixPrefix.length),
  );
  return Number.isInteger(index) && index >= 0 ? index : null;
}
