import type { MatchResult } from "path-to-regexp";
import { compile, match } from "path-to-regexp";

// Role menu interaction custom IDs (for sent menus)
enum RoleMenuPaths {
  // New format with menu name for database lookup
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
  // New format with menu name
  button: createCustomIdHelper(RoleMenuPaths.Button),
  select: createCustomIdHelper(RoleMenuPaths.Select),

  // Legacy format for backwards compatibility
  legacyButton: createCustomIdHelper(RoleMenuPaths.LegacyButton),
  legacySelect: createCustomIdHelper(RoleMenuPaths.LegacySelect),
};

// Helper to parse any role menu button (new or legacy format)
export function parseRoleMenuButtonCustomId(customId: string): {
  menuName?: string;
  roleId: string;
  isLegacy: boolean;
} | null {
  // Try new format first
  const newParams = roleMenuCustomIds.button.matchParams(customId);
  if (newParams) {
    return {
      menuName: newParams.menuName,
      roleId: newParams.roleId,
      isLegacy: false,
    };
  }

  // Try legacy format
  const legacyParams = roleMenuCustomIds.legacyButton.matchParams(customId);
  if (legacyParams) {
    return {
      roleId: legacyParams.roleId,
      isLegacy: true,
    };
  }

  return null;
}

// Helper to parse any role menu select (new or legacy format)
export function parseRoleMenuSelectCustomId(customId: string): {
  menuName?: string;
  isLegacy: boolean;
} | null {
  // Try new format first
  const newParams = roleMenuCustomIds.select.matchParams(customId);
  if (newParams) {
    return {
      menuName: newParams.menuName,
      isLegacy: false,
    };
  }

  // Try legacy format
  const legacyParams = roleMenuCustomIds.legacySelect.matchParams(customId);
  if (legacyParams) {
    return {
      isLegacy: true,
    };
  }

  return null;
}
