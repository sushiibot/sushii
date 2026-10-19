export interface RoleMenuSelectionChanges {
  toAdd: string[];
  toRemove: string[];
}

/**
 * Computes which roles to add and remove for a select menu submission.
 * Only roles that are part of the menu are ever added or removed.
 */
export function computeRoleMenuSelectionChanges(params: {
  currentRoleIds: Iterable<string>;
  selectedRoleIds: Iterable<string>;
  menuRoleIds: Iterable<string>;
}): RoleMenuSelectionChanges {
  const current = new Set(params.currentRoleIds);
  const menu = new Set(params.menuRoleIds);
  const selected = new Set(
    [...params.selectedRoleIds].filter((roleId) => menu.has(roleId)),
  );

  const toAdd = [...selected].filter((roleId) => !current.has(roleId));
  const toRemove = [...menu].filter(
    (roleId) => current.has(roleId) && !selected.has(roleId),
  );

  return { toAdd, toRemove };
}

export function findRolesNotInMenu(
  roleIds: Iterable<string>,
  menuRoleIds: Iterable<string>,
): string[] {
  const menu = new Set(menuRoleIds);
  return [...new Set(roleIds)].filter((roleId) => !menu.has(roleId));
}
