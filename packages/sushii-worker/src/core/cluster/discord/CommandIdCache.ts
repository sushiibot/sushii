import type { REST } from "discord.js";
import { ApplicationCommandType, Routes } from "discord.js";

import log from "@/shared/infrastructure/logger";
import {
  type CommandMentions,
  fallbackMention,
} from "@/shared/presentation/commandMentions";

export const MISS_REFETCH_INTERVAL_MS = 5 * 60 * 1000;
export const FAILED_REFETCH_INTERVAL_MS = 30 * 1000;

export interface RegisteredCommand {
  id: string;
  name: string;
  type?: ApplicationCommandType;
}

export interface KnownCommands {
  isKnown(name: string, guildId?: string): boolean;
  guildIds(): Iterable<string>;
}

interface CachedCommand {
  id: string;
  type: ApplicationCommandType;
}

export class CommandIdCache implements CommandMentions {
  private global = new Map<string, CachedCommand>();
  private guilds = new Map<string, Map<string, CachedCommand>>();
  private inFlight: Promise<void> | undefined;
  private nextMissRefetchAt = 0;

  constructor(
    private readonly rest: Pick<REST, "get">,
    private readonly applicationId: string,
    private readonly known: KnownCommands,
    private readonly now: () => number = Date.now,
  ) {}

  setGlobal(commands: readonly RegisteredCommand[]): void {
    this.global = toCommandMap(commands);
  }

  setGuild(guildId: string, commands: readonly RegisteredCommand[]): void {
    this.guilds.set(guildId, toCommandMap(commands));
  }

  mention(path: string, guildId?: string): string {
    const normalized = path.trim().split(/\s+/).join(" ");
    const root = normalized.split(" ")[0];

    const command =
      slashOnly(guildId ? this.guilds.get(guildId)?.get(root) : undefined) ??
      slashOnly(this.global.get(root));

    if (command) {
      return `</${normalized}:${command.id}>`;
    }

    if (this.known.isKnown(root, guildId)) {
      this.refetchOnMiss();
    }

    return fallbackMention(normalized);
  }

  refresh(): Promise<void> {
    return this.run(true);
  }

  /**
   * Startup fetch. Doesn't start the miss window, so a command that shard 0
   * registers after this GET is still picked up on its first miss.
   */
  prime(): Promise<void> {
    return this.run(false);
  }

  private run(startsWindow: boolean): Promise<void> {
    if (!this.inFlight) {
      this.inFlight = this.fetchAll(startsWindow).finally(() => {
        this.inFlight = undefined;
      });
    }
    return this.inFlight;
  }

  private async fetchAll(startsWindow: boolean): Promise<void> {
    if (startsWindow) {
      this.nextMissRefetchAt = this.now() + MISS_REFETCH_INTERVAL_MS;
    }

    let globalFailed = false;

    try {
      const commands = (await this.rest.get(
        Routes.applicationCommands(this.applicationId),
      )) as RegisteredCommand[];
      this.setGlobal(commands);
    } catch (err) {
      globalFailed = true;
      log.warn({ err }, "failed to fetch global command IDs");
    }

    for (const guildId of this.known.guildIds()) {
      try {
        const commands = (await this.rest.get(
          Routes.applicationGuildCommands(this.applicationId, guildId),
        )) as RegisteredCommand[];
        this.setGuild(guildId, commands);
      } catch (err) {
        log.warn({ err, guildId }, "failed to fetch guild command IDs");
      }
    }

    // Guild failures don't shorten the window: a guild the bot left fails forever.
    if (globalFailed) {
      this.nextMissRefetchAt = this.now() + FAILED_REFETCH_INTERVAL_MS;
    }
  }

  private refetchOnMiss(): void {
    if (this.inFlight || this.now() < this.nextMissRefetchAt) {
      return;
    }

    void this.refresh();
  }
}

function slashOnly(
  command: CachedCommand | undefined,
): CachedCommand | undefined {
  return command?.type === ApplicationCommandType.ChatInput
    ? command
    : undefined;
}

function toCommandMap(
  commands: readonly RegisteredCommand[],
): Map<string, CachedCommand> {
  const map = new Map<string, CachedCommand>();
  for (const command of commands) {
    const type = command.type ?? ApplicationCommandType.ChatInput;
    // Context menus can share a name with a slash command; only slash commands are mentionable.
    if (map.get(command.name)?.type === ApplicationCommandType.ChatInput) {
      continue;
    }
    map.set(command.name, { id: command.id, type });
  }
  return map;
}
