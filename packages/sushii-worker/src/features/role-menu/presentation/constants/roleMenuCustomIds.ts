import type { MatchResult } from "path-to-regexp";
import { compile, match } from "path-to-regexp";

// Role menu interaction custom IDs (for sent menus)
enum RoleMenuPaths {
  // New ultra-short format with numeric ID (preferred)
  ShortButton = "/rm/:id/b/:roleId",
  ShortSelect = "/rm/:id/s",

  // Legacy 2.0 format with menu name for database lookup (exceeds limit due to URL encoding)
  Button = "/rolemenu/:menuName/button/:roleId",
  Select = "/rolemenu/:menuName/select",

  // Legacy format for backwards compatibility
  LegacyButton = "/rolemenu/button/:roleId",
  LegacySelect = "/rolemenu/select",
}

// Role menu builder custom IDs (for edit interface)
export const ROLE_MENU_BUILDER_CUSTOM_IDS = {
  EDIT_DESCRIPTION: "role_menu_builder_edit_description",
  SET_MAX_ROLES: "role_menu_builder_set_max_roles",
  ROLE_SELECT: "role_menu_builder_role_select",
  REQUIRED_ROLE_SELECT: "role_menu_builder_required_role_select",
  EDIT_ROLE_OPTIONS: "role_menu_builder_edit_role_options",
  FINISH_AND_UPDATE: "role_menu_builder_finish_and_update",
};

export const ROLE_MENU_BUILDER_INPUTS = {
  DESCRIPTION: "role_menu_builder_description_input",
  MAX_ROLES: "role_menu_builder_max_roles_input",
  ROLE_EMOJI: "role_menu_builder_role_emoji_input",
  ROLE_DESCRIPTION: "role_menu_builder_role_description_input",
};

export const ROLE_MENU_BUILDER_MODALS = {
  EDIT_DESCRIPTION: "role_menu_builder_edit_description_modal",
  SET_MAX_ROLES: "role_menu_builder_set_max_roles_modal",
  EDIT_ROLE_OPTIONS: "role_menu_builder_edit_role_options_modal",
};

// Create custom ID helper for role menu interactions
function createCustomIdHelper(path: string) {
  const compileFn = compile(path);
  const matchFn = match(path, { decode: decodeURIComponent });

  return {
    compile: compileFn,
    match: matchFn,
    matchParams: (customId: string) => {
      const result = matchFn(customId) as
        | MatchResult<Record<string, string>>
        | false;
      return result ? (result.params as Record<string, string>) : null;
    },
  };
}

// Export custom ID helpers
export const roleMenuCustomIds = {
  // New ultra-short format with ID (preferred)
  shortButton: createCustomIdHelper(RoleMenuPaths.ShortButton),
  shortSelect: createCustomIdHelper(RoleMenuPaths.ShortSelect),

  // Current format with menu name
  button: createCustomIdHelper(RoleMenuPaths.Button),
  select: createCustomIdHelper(RoleMenuPaths.Select),

  // Legacy format for backwards compatibility
  legacyButton: createCustomIdHelper(RoleMenuPaths.LegacyButton),
  legacySelect: createCustomIdHelper(RoleMenuPaths.LegacySelect),
};

// Helper to parse any role menu button (all formats)
export function parseRoleMenuButtonCustomId(customId: string): {
  id?: number;
  menuName?: string;
  roleId: string;
  isLegacy: boolean;
  isShort: boolean;
} | null {
  // Try short format first (preferred)
  const shortParams = roleMenuCustomIds.shortButton.matchParams(customId);
  if (shortParams) {
    return {
      id: parseInt(shortParams.id, 10),
      roleId: shortParams.roleId,
      isLegacy: false,
      isShort: true,
    };
  }

  // Try current format with menu name
  const newParams = roleMenuCustomIds.button.matchParams(customId);
  if (newParams) {
    return {
      menuName: newParams.menuName,
      roleId: newParams.roleId,
      isLegacy: false,
      isShort: false,
    };
  }

  // Try legacy format
  const legacyParams = roleMenuCustomIds.legacyButton.matchParams(customId);
  if (legacyParams) {
    return {
      roleId: legacyParams.roleId,
      isLegacy: true,
      isShort: false,
    };
  }

  return null;
}

// Helper to parse any role menu select (all formats)
export function parseRoleMenuSelectCustomId(customId: string): {
  id?: number;
  menuName?: string;
  isLegacy: boolean;
  isShort: boolean;
} | null {
  // Try short format first (preferred)
  const shortParams = roleMenuCustomIds.shortSelect.matchParams(customId);
  if (shortParams) {
    return {
      id: parseInt(shortParams.id, 10),
      isLegacy: false,
      isShort: true,
    };
  }

  // Try current format with menu name
  const newParams = roleMenuCustomIds.select.matchParams(customId);
  if (newParams) {
    return {
      menuName: newParams.menuName,
      isLegacy: false,
      isShort: false,
    };
  }

  // Try legacy format
  const legacyParams = roleMenuCustomIds.legacySelect.matchParams(customId);
  if (legacyParams) {
    return {
      isLegacy: true,
      isShort: false,
    };
  }

  return null;
}
