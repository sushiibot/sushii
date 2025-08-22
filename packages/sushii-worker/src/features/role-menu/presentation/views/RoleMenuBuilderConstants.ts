export const ROLE_MENU_BUILDER_CUSTOM_IDS = {
  EDIT_DESCRIPTION: "role_menu_builder_edit_description",
  SET_MAX_ROLES: "role_menu_builder_set_max_roles",
  ROLE_SELECT: "role_menu_builder_role_select",
  REQUIRED_ROLE_SELECT: "role_menu_builder_required_role_select",
  EDIT_ROLE_OPTIONS: "role_menu_builder_edit_role_options",
} as const;

export const ROLE_MENU_BUILDER_MODALS = {
  DESCRIPTION: "role_menu_builder_description_modal",
  MAX_ROLES: "role_menu_builder_max_roles_modal",
  ROLE_OPTIONS: "role_menu_builder_role_options_modal",
} as const;

export const ROLE_MENU_BUILDER_INPUTS = {
  DESCRIPTION: "description_input",
  MAX_ROLES: "max_roles_input",
  EMOJI: "emoji_input",
  ROLE_DESCRIPTION: "role_description_input",
} as const;

export interface RoleMenuBuilderState {
  guildId: string;
  menuName: string;
  disabled: boolean;
  expired: boolean;
  isEdit?: boolean;
}