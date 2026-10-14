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
  tabMembers: "permaudit_tab_members",
} as const;
