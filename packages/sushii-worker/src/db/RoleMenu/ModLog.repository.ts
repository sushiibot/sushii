import type { Kysely } from "kysely";
import type { DB } from "../../infrastructure/database/dbTypes";
import type {
  InsertableRoleMenuRoleRow,
  InsertableRoleMenuRow,
  RoleMenuRoleRow,
  RoleMenuRow,
} from "./RoleMenu.table";

export async function upsertRoleMenu(
  db: Kysely<DB>,
  roleMenu: InsertableRoleMenuRow,
): Promise<void> {
  await db
    .insertInto("app_public.role_menus")
    .values(roleMenu)
    .onConflict((oc) =>
      oc.columns(["guild_id", "menu_name"]).doUpdateSet(roleMenu),
    )
    .execute();
}

export async function getRoleMenu(
  db: Kysely<DB>,
  guildId: string,
  menuName: string,
): Promise<RoleMenuRow | undefined> {
  return db
    .selectFrom("app_public.role_menus")
    .selectAll()
    .where("guild_id", "=", guildId)
    .where("menu_name", "=", menuName)
    .executeTakeFirst();
}

export async function listRoleMenus(
  db: Kysely<DB>,
  guildId: string,
): Promise<InsertableRoleMenuRow[]> {
  return db
    .selectFrom("app_public.role_menus")
    .selectAll()
    .where("guild_id", "=", guildId)
    .execute();
}

export async function searchRoleMenus(
  db: Kysely<DB>,
  guildId: string,
  query: string,
): Promise<InsertableRoleMenuRow[]> {
  return db
    .selectFrom("app_public.role_menus")
    .selectAll()
    .where("guild_id", "=", guildId)
    .where("menu_name", "ilike", `${query}%`)
    .execute();
}

export async function deleteRoleMenu(
  db: Kysely<DB>,
  guildId: string,
  menuName: string,
): Promise<void> {
  await db
    .deleteFrom("app_public.role_menus")
    .where("guild_id", "=", guildId)
    .where("menu_name", "=", menuName)
    .execute();
}

export async function getRoleMenuRole(
  db: Kysely<DB>,
  guildId: string,
  menuName: string,
  roleId: string,
): Promise<RoleMenuRoleRow | undefined> {
  return db
    .selectFrom("app_public.role_menu_roles")
    .selectAll()
    .where("guild_id", "=", guildId)
    .where("menu_name", "=", menuName)
    .where("role_id", "=", roleId)
    .executeTakeFirst();
}

export async function getRoleMenuRoles(
  db: Kysely<DB>,
  guildId: string,
  menuName: string,
): Promise<RoleMenuRoleRow[]> {
  return (
    db
      .selectFrom("app_public.role_menu_roles")
      .selectAll()
      .where("guild_id", "=", guildId)
      .where("menu_name", "=", menuName)
      // Sorted by position, lowest to highest
      .orderBy("position", "asc")
      .execute()
  );
}

export async function addRoleMenuRoles(
  db: Kysely<DB>,
  guildId: string,
  menuName: string,
  roleIds: string[],
): Promise<void> {
  if (roleIds.length === 0) {
    return;
  }

  await db.transaction().execute(async (trx) => {
    // Get the max of the existing role menu roles
    const maxPosition = await trx
      .selectFrom("app_public.role_menu_roles")
      .select((eb) => eb.fn.max("position").as("max_position"))
      .where("guild_id", "=", guildId)
      .where("menu_name", "=", menuName)
      .executeTakeFirst();

    // New values start at 1, or the max position + 1
    let startPosition: number;
    if (maxPosition?.max_position) {
      startPosition = maxPosition.max_position + 1;
    } else {
      startPosition = 1;
    }

    // Assign positions and metadata to the new roles
    const values = roleIds.map((roleId, index) => ({
      guild_id: guildId,
      menu_name: menuName,
      role_id: roleId,
      position: startPosition + index,
    }));

    // Bulk insert, ignoring any conflicts (i.e. if the role already exists in menu)
    // position values would be skipped but that's not an issue
    await trx
      .insertInto("app_public.role_menu_roles")
      .values(values)
      .onConflict((oc) =>
        oc.columns(["guild_id", "menu_name", "role_id"]).doNothing(),
      )
      .execute();
  });
}

export async function deleteRoleMenuRoles(
  db: Kysely<DB>,
  guildId: string,
  menuName: string,
  roleIds: string[],
): Promise<void> {
  await db
    .deleteFrom("app_public.role_menu_roles")
    .where("guild_id", "=", guildId)
    .where("menu_name", "=", menuName)
    .where("role_id", "in", roleIds)
    .execute();
}

export async function upsertRoleMenuRole(
  db: Kysely<DB>,
  roleMenuRole: InsertableRoleMenuRoleRow,
): Promise<void> {
  await db
    .insertInto("app_public.role_menu_roles")
    .values(roleMenuRole)
    .onConflict((oc) =>
      oc
        .columns(["guild_id", "menu_name", "role_id"])
        .doUpdateSet(roleMenuRole),
    )
    .execute();
}

export async function reorderRoleMenuRoles(
  db: Kysely<DB>,
  guildId: string,
  menuName: string,
  roleIds: string[],
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    // Get the current positions of the roles
    const currentRoles = await trx
      .selectFrom("app_public.role_menu_roles")
      .selectAll()
      .where("guild_id", "=", guildId)
      .where("menu_name", "=", menuName)
      .execute();

    // Ensure supplied roleIds matches currentroles
    const currentRoleIds = currentRoles.map((role) => role.role_id);
    if (currentRoleIds.length !== roleIds.length) {
      throw new Error("Mismatched supplied roleIds");
    }

    // Ensure supplied roleIds matches currentroles
    const roleIdsSet = new Set(roleIds);
    for (const roleId of currentRoleIds) {
      if (!roleIdsSet.has(roleId)) {
        throw new Error("Mismatched supplied roleIds");
      }
    }

    // Generate a new series of role positions
    const updateMap = new Map<string, number>();
    for (let i = 0; i < roleIds.length; i += 1) {
      updateMap.set(roleIds[i], i + 1);
    }

    // Create the new values to update
    const values = currentRoles.map((role) => ({
      ...role,
      position: updateMap.get(role.role_id),
    }));

    // Bulk update the positions of the roles
    await trx
      .insertInto("app_public.role_menu_roles")
      .values(values)
      .onConflict((oc) =>
        oc.columns(["guild_id", "menu_name", "role_id"]).doUpdateSet({
          // Update with the new position
          position: (eb) => eb.ref("excluded.position"),
        }),
      )
      .execute();
  });
}
