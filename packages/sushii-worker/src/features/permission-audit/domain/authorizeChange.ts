import { PermissionFlagsBits } from "discord.js";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type { PlannedChange } from "./planChange";

export interface ChangeActor {
  name: "You" | "sushii";
  isOwner: boolean;
  /** Guild-level permissions. */
  permissions: bigint;
  /** Permissions in the change's channel, for override edits. */
  channelPermissions: bigint | null;
  highestRolePosition: number;
}

export interface ChangeTarget {
  /** Position of the role being edited, or the source role for a split. */
  rolePosition: number | null;
  roleName: string | null;
}

/**
 * The runner must be able to make the change by hand in Discord, and so must
 * sushii, so neither can escalate through the other. Checked against live
 * permissions on every click.
 */
export function authorizeChange(
  change: PlannedChange,
  target: ChangeTarget,
  actors: readonly ChangeActor[],
): Result<void, string> {
  for (const actor of actors) {
    const result = authorizeActor(change, target, actor);
    if (result.err) {
      return result;
    }
  }

  return Ok.EMPTY;
}

function authorizeActor(
  change: PlannedChange,
  target: ChangeTarget,
  actor: ChangeActor,
): Result<void, string> {
  const need = actor.name === "You" ? "You need" : "sushii needs";

  if (change.kind === "edit_overwrite" || change.kind === "delete_overwrite") {
    const channel = actor.channelPermissions ?? 0n;
    if (!actor.isOwner && !has(channel, PermissionFlagsBits.ManageRoles)) {
      return Err(`${need} Manage Permissions in <#${change.channelId}>.`);
    }
    return Ok.EMPTY;
  }

  if (
    !actor.isOwner &&
    !has(actor.permissions, PermissionFlagsBits.ManageRoles)
  ) {
    return Err(`${need} Manage Roles.`);
  }

  if (
    !actor.isOwner &&
    target.rolePosition != null &&
    actor.highestRolePosition <= target.rolePosition
  ) {
    const whose = actor.name === "You" ? "your" : "sushii's";
    return Err(
      `${target.roleName ?? "That role"} isn't below ${whose} highest role.`,
    );
  }

  const granted = grantedBits(change);
  if (
    !actor.isOwner &&
    !has(actor.permissions, PermissionFlagsBits.Administrator)
  ) {
    const missing = granted & ~actor.permissions;
    if (missing !== 0n) {
      return Err(
        `${need} every permission this change grants. Discord doesn't let anyone grant permissions they don't have.`,
      );
    }
  }

  return Ok.EMPTY;
}

/** Only additions are limited by the actor's own permissions; removals never are. */
function grantedBits(change: PlannedChange): bigint {
  switch (change.kind) {
    case "set_role_permissions":
      return change.after & ~change.before;
    case "create_role":
      return change.permissions;
    case "edit_overwrite":
    case "delete_overwrite":
      return 0n;
  }
}

function has(bits: bigint, flag: bigint): boolean {
  return (
    (bits & flag) === flag || (bits & PermissionFlagsBits.Administrator) !== 0n
  );
}
