/**
 * Flat custom ID literals for the Mod View. No builder/parser: the view owns
 * one collector scoped to its own message, so these never need to survive a
 * restart or be reconstructed from an interaction.
 *
 * The `modview_` prefix must never be claimed by any globally-routed
 * `customIDMatch` — see the guard test in `customIds.test.ts`. If a global
 * handler claims a click here, `InteractionRouter` handles it before the
 * view's own collector ever sees it, destroying the message chrome.
 */
export const MODVIEW_CUSTOM_IDS = {
  tabOverview: "modview_tab_overview",
  tabHistory: "modview_tab_history",
  tabAlts: "modview_tab_alts",
  tabNames: "modview_tab_names",
  tabLookup: "modview_tab_lookup",
  /**
   * The Overview rows' `View ›` accessories. Distinct from the tab-row IDs
   * above even though they open the same screens: Discord rejects a message
   * whose components share a `custom_id`, and Overview renders both sets.
   */
  openHistory: "modview_open_history",
  openAlts: "modview_open_alts",
  openNames: "modview_open_names",
  openLookup: "modview_open_lookup",
  historyAlts: "modview_history_alts",
  altsNickname: "modview_alts_nickname",
  /** Prefix only — the live modal ID appends the triggering interaction's ID. */
  altsNicknameModal: "modview_alts_nickname_modal",
} as const;
