import type {
  APIApplicationCommandOption,
  RESTPostAPIApplicationCommandsJSONBody,
} from "discord.js";
import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
} from "discord.js";

import type {
  HelpAudience,
  HelpCategory,
  HelpCommandEntry,
} from "../domain/helpCatalog";
import { HELP_CATEGORIES, HELP_HIDDEN } from "../domain/helpCatalog";

export type HelpAppTarget = "user" | "message";

interface HelpIndexEntryBase {
  /** "rolemenu", "rolemenu create", "xp block channel", or an app name like "User Info". */
  path: string;
  root: string;
  description: string;
  rootCategory: HelpCategory | null;
  audience: HelpAudience | null;
  defaultMemberPermissions: string | null | undefined;
  keywords: readonly string[];
}

export interface HelpSlashEntry extends HelpIndexEntryBase {
  kind: "slash";
  /** Catalog entry of a top-level command; null for subcommands and uncatalogued roots. */
  catalog: HelpCommandEntry | null;
}

export interface HelpAppEntry extends HelpIndexEntryBase {
  kind: "app";
  appTarget: HelpAppTarget;
}

export type HelpIndexEntry = HelpSlashEntry | HelpAppEntry;

export const APP_DESCRIPTION = "Right-click app";

interface RootPosition {
  category: HelpCategory;
  rank: number;
  catalog: HelpCommandEntry | null;
}

function catalogPositions(
  categories: readonly HelpCategory[],
): Map<string, RootPosition> {
  const positions = new Map<string, RootPosition>();
  let rank = 0;
  for (const category of categories) {
    for (const command of category.commands) {
      positions.set(command.name, { category, rank: rank++, catalog: command });
    }
    for (const app of category.apps ?? []) {
      positions.set(app, { category, rank: rank++, catalog: null });
    }
  }
  return positions;
}

function subcommandPaths(
  root: string,
  options: readonly APIApplicationCommandOption[] | undefined,
): { path: string; description: string }[] {
  const paths: { path: string; description: string }[] = [];
  for (const option of options ?? []) {
    if (option.type === ApplicationCommandOptionType.Subcommand) {
      paths.push({
        path: `${root} ${option.name}`,
        description: option.description,
      });
    } else if (option.type === ApplicationCommandOptionType.SubcommandGroup) {
      for (const sub of option.options ?? []) {
        paths.push({
          path: `${root} ${option.name} ${sub.name}`,
          description: sub.description,
        });
      }
    }
  }
  return paths;
}

function appTarget(type: ApplicationCommandType): HelpAppTarget | null {
  if (type === ApplicationCommandType.User) {
    return "user";
  }
  if (type === ApplicationCommandType.Message) {
    return "message";
  }
  return null;
}

/** Entries in catalog order (unknown roots last), each root before its subcommands. */
export function buildHelpIndex(
  commands: readonly RESTPostAPIApplicationCommandsJSONBody[],
  categories: readonly HelpCategory[] = HELP_CATEGORIES,
): HelpIndexEntry[] {
  const positions = catalogPositions(categories);
  const rankOf = (name: string) =>
    positions.get(name)?.rank ?? Number.MAX_SAFE_INTEGER;

  const roots = commands
    .filter((c) => !HELP_HIDDEN.has(c.name))
    .map((command, i) => ({ command, i }))
    .sort(
      (a, b) => rankOf(a.command.name) - rankOf(b.command.name) || a.i - b.i,
    );

  return roots.flatMap(({ command }): HelpIndexEntry[] => {
    const position = positions.get(command.name);
    const shared = {
      root: command.name,
      rootCategory: position?.category ?? null,
      audience: position?.category.audience ?? null,
      defaultMemberPermissions: command.default_member_permissions,
      keywords: position?.catalog?.keywords ?? [],
    };

    const target = appTarget(command.type ?? ApplicationCommandType.ChatInput);
    if (target) {
      return [
        {
          ...shared,
          path: command.name,
          kind: "app",
          description: APP_DESCRIPTION,
          appTarget: target,
        },
      ];
    }

    const options =
      command.type === undefined ||
      command.type === ApplicationCommandType.ChatInput
        ? command.options
        : undefined;
    const description = "description" in command ? command.description : "";

    return [
      {
        ...shared,
        path: command.name,
        kind: "slash",
        description,
        catalog: position?.catalog ?? null,
      },
      ...subcommandPaths(command.name, options).map(
        (sub): HelpIndexEntry => ({
          ...shared,
          ...sub,
          kind: "slash",
          catalog: null,
        }),
      ),
    ];
  });
}

/** Lowercase, no leading slash, and spaces, underscores and hyphens as single spaces. */
export function normalizeQuery(query: string): string {
  return query
    .trim()
    .replace(/^\//, "")
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .trim();
}

const MIN_SUBSTRING_QUERY = 3;

function startsAtWord(haystack: string, query: string): boolean {
  return ` ${normalizeQuery(haystack)}`.includes(` ${query}`);
}

function matchTier(entry: HelpIndexEntry, query: string): number | null {
  const path = normalizeQuery(entry.path);
  if (path === query) {
    return 0;
  }
  if (path.startsWith(query)) {
    return 1;
  }
  if (` ${path}`.includes(` ${query}`)) {
    return 2;
  }
  if (query.length >= MIN_SUBSTRING_QUERY && path.includes(query)) {
    return 3;
  }
  // Apps share a fixed description, so they match by name only.
  if (
    entry.kind === "slash" &&
    (startsAtWord(entry.description, query) ||
      entry.keywords.some((k) => startsAtWord(k, query)))
  ) {
    return 4;
  }
  return null;
}

/** Matching entries by tier, keeping index order within a tier. */
export function rankHelpEntries(
  entries: readonly HelpIndexEntry[],
  query: string,
): HelpIndexEntry[] {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return [...entries];
  }

  return entries
    .map((entry, i) => ({ entry, i, tier: matchTier(entry, normalized) }))
    .filter(
      (m): m is { entry: HelpIndexEntry; i: number; tier: number } =>
        m.tier !== null,
    )
    .sort((a, b) => a.tier - b.tier || a.i - b.i)
    .map((m) => m.entry);
}

export function findExactEntry(
  entries: readonly HelpIndexEntry[],
  query: string,
): HelpIndexEntry | null {
  const normalized = normalizeQuery(query);
  return entries.find((e) => normalizeQuery(e.path) === normalized) ?? null;
}
