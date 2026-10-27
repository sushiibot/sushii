import type {
  PermissionsBitField,
  RESTPostAPIApplicationCommandsJSONBody,
} from "discord.js";
import { PermissionFlagsBits } from "discord.js";

import type {
  HelpAudience,
  HelpCategory,
  HelpCommandEntry,
} from "../domain/helpCatalog";
import { HELP_AUDIENCES, HELP_CATEGORIES } from "../domain/helpCatalog";

export type CommandListProvider =
  () => RESTPostAPIApplicationCommandsJSONBody[];

export interface VisibleCategory {
  category: HelpCategory;
  commands: HelpCommandEntry[];
  apps: string[];
}

export interface VisibleHelp {
  audiences: HelpAudience[];
  categories: VisibleCategory[];
}

export function canRun(
  defaultMemberPermissions: string | null | undefined,
  memberPermissions: Readonly<PermissionsBitField> | null,
): boolean {
  if (
    defaultMemberPermissions === null ||
    defaultMemberPermissions === undefined
  ) {
    return true;
  }

  if (!memberPermissions) {
    return false;
  }

  // "0" hides a command from everyone but admins, and has(0n) is always true.
  const required = BigInt(defaultMemberPermissions);
  if (required === 0n) {
    return memberPermissions.has(PermissionFlagsBits.Administrator);
  }

  return memberPermissions.has(required);
}

/** Catalog entries the member can run; unregistered names count as not runnable. */
export function resolveVisibleHelp(
  commands: readonly RESTPostAPIApplicationCommandsJSONBody[],
  memberPermissions: Readonly<PermissionsBitField> | null,
  categories: readonly HelpCategory[] = HELP_CATEGORIES,
): VisibleHelp {
  const usable = new Set(
    commands
      .filter((c) => canRun(c.default_member_permissions, memberPermissions))
      .map((c) => c.name),
  );

  const visible = categories
    .map((category) => ({
      category,
      commands: category.commands.filter((c) => usable.has(c.name)),
      apps: (category.apps ?? []).filter((name) => usable.has(name)),
    }))
    .filter((v) => v.commands.length > 0);

  const audiences = HELP_AUDIENCES.filter((audience) =>
    visible.some((v) => v.category.audience === audience),
  );

  return { audiences, categories: visible };
}

export function isNew(entry: HelpCommandEntry, now: Date): boolean {
  return (
    entry.newUntil !== undefined && now.getTime() < Date.parse(entry.newUntil)
  );
}
