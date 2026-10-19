export interface LevelRoleDiff {
  toAdd: string[];
  toRemove: string[];
}

/**
 * Computes the minimal level role changes for a member. Only roles in the
 * add/remove lists are considered, so unrelated roles are never touched.
 * Removal wins if a role appears in both lists.
 */
export function computeLevelRoleDiff(
  currentRoleIds: Iterable<string>,
  addRoleIds: readonly string[] | null,
  removeRoleIds: readonly string[] | null,
): LevelRoleDiff {
  const current = new Set(currentRoleIds);
  const remove = new Set(removeRoleIds ?? []);

  const toAdd = [...new Set(addRoleIds ?? [])].filter(
    (id) => !current.has(id) && !remove.has(id),
  );
  const toRemove = [...remove].filter((id) => current.has(id));

  return { toAdd, toRemove };
}
