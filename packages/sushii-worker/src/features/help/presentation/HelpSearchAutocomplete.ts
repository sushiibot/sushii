import type {
  APIApplicationCommandOptionChoice,
  AutocompleteFocusedOption,
  AutocompleteInteraction,
  PermissionsBitField,
} from "discord.js";

import { AutocompleteHandler } from "@/shared/presentation/handlers";

import type { HelpIndexEntry, HelpSlashEntry } from "../application/helpIndex";
import {
  buildHelpIndex,
  normalizeQuery,
  rankHelpEntries,
} from "../application/helpIndex";
import type { HelpAudience, HelpCommandEntry } from "../domain/helpCatalog";
import { HELP_NEW_ORDER } from "../domain/helpCatalog";
import type { CommandListProvider } from "./helpVisibility";
import { canRun, isNew } from "./helpVisibility";
import { truncateCodePoints } from "./truncate";

const MAX_CHOICES = 25;
const MAX_CHOICE_LENGTH = 100;

function choiceFor(
  entry: HelpIndexEntry,
  prefix = "",
): APIApplicationCommandOptionChoice<string> {
  const name =
    entry.kind === "app"
      ? `${entry.path} (right-click app)`
      : `/${entry.path} · ${entry.description}`;
  return {
    name: truncateCodePoints(`${prefix}${name}`, MAX_CHOICE_LENGTH),
    value: truncateCodePoints(entry.path, MAX_CHOICE_LENGTH),
  };
}

// Staff see their own tools first; members only have the members audience.
const AUDIENCE_PRIORITY: readonly HelpAudience[] = [
  "admins",
  "moderators",
  "members",
];

function emptyQueryChoices(
  runnable: readonly HelpIndexEntry[],
  now: Date,
): APIApplicationCommandOptionChoice<string>[] {
  const catalogued = runnable.filter(
    (e): e is HelpSlashEntry & { catalog: HelpCommandEntry } =>
      e.kind === "slash" && e.catalog !== null,
  );
  const newRank = (path: string) => {
    const i = HELP_NEW_ORDER.indexOf(path);
    return i === -1 ? HELP_NEW_ORDER.length : i;
  };
  const audienceRank = (e: HelpIndexEntry) =>
    e.audience
      ? AUDIENCE_PRIORITY.indexOf(e.audience)
      : AUDIENCE_PRIORITY.length;

  const fresh = catalogued
    .filter((e) => isNew(e.catalog, now))
    .sort((a, b) => newRank(a.path) - newRank(b.path));
  const freshPaths = new Set(fresh.map((e) => e.path));
  const rest = catalogued
    .filter((e) => !freshPaths.has(e.path))
    .sort((a, b) => audienceRank(a) - audienceRank(b));

  return [
    ...fresh.map((e) => choiceFor(e, "New · ")),
    ...rest.map((e) => choiceFor(e)),
  ].slice(0, MAX_CHOICES);
}

export function buildHelpChoices(
  entries: readonly HelpIndexEntry[],
  query: string,
  memberPermissions: Readonly<PermissionsBitField> | null,
  now: Date,
): APIApplicationCommandOptionChoice<string>[] {
  const runnable = entries.filter((e) =>
    canRun(e.defaultMemberPermissions, memberPermissions),
  );

  if (!normalizeQuery(query)) {
    return emptyQueryChoices(runnable, now);
  }

  return rankHelpEntries(runnable, query)
    .slice(0, MAX_CHOICES)
    .map((e) => choiceFor(e));
}

export class HelpSearchAutocomplete extends AutocompleteHandler {
  readonly fullCommandNamePath = "help";

  constructor(
    private readonly commandList: CommandListProvider,
    private readonly now: () => Date = () => new Date(),
  ) {
    super();
  }

  protected async handleAutocomplete(
    interaction: AutocompleteInteraction,
    option: AutocompleteFocusedOption,
  ): Promise<void> {
    if (!this.validateStringOption(option)) {
      throw new Error("Help search option must be a string");
    }

    const choices = buildHelpChoices(
      buildHelpIndex(this.commandList()),
      option.value,
      interaction.memberPermissions,
      this.now(),
    );

    await interaction.respond(choices);
  }
}
