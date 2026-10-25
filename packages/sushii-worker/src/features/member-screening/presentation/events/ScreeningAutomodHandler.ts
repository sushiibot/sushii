import {
  type AutoModerationActionExecution,
  AutoModerationActionType,
  DiscordAPIError,
  Events,
  type Guild,
  type GuildMember,
  RESTJSONErrorCodes,
} from "discord.js";
import type { Logger } from "pino";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type { MemberScreeningService } from "../../application/MemberScreeningService";
import type { ScreeningGuildRepository } from "../../domain/repositories/ScreeningGuildRepository";
import { ScreeningSettingsLookup } from "./ScreeningSettingsLookup";
import { isScreeningExempt } from "./screeningExemption";

const HOUR_MS = 60 * 60 * 1000;
const FALLBACK_RULE_NAME = "AutoMod rule";

async function fetchMember(
  guild: Guild,
  userId: string,
): Promise<GuildMember | null> {
  try {
    return await guild.members.fetch(userId);
  } catch (err) {
    if (
      err instanceof DiscordAPIError &&
      err.code === RESTJSONErrorCodes.UnknownMember
    ) {
      return null;
    }
    throw err;
  }
}

/** One event fires per rule action, so only the block is recorded: a block+alert rule would otherwise count twice. */
export class ScreeningAutomodHandler extends EventHandler<Events.AutoModerationActionExecution> {
  readonly eventType = Events.AutoModerationActionExecution;
  private readonly settings: ScreeningSettingsLookup;

  constructor(
    private readonly service: MemberScreeningService,
    guildRepo: ScreeningGuildRepository,
    private readonly logger: Logger,
    private readonly now: () => number = Date.now,
  ) {
    super();
    this.settings = new ScreeningSettingsLookup(guildRepo, logger, now);
  }

  async handle(execution: AutoModerationActionExecution): Promise<void> {
    if (execution.action.type !== AutoModerationActionType.BlockMessage) {
      return;
    }

    const { guild } = execution;
    const settings = await this.settings.find(guild.id);
    if (!settings) {
      return;
    }

    // Fetched only when uncached, since joinedAt is the only way to know the window.
    const member =
      execution.member ?? (await fetchMember(guild, execution.userId));
    if (!member?.joinedAt) {
      return;
    }
    if (
      this.now() - member.joinedAt.getTime() >=
      settings.windowHours * HOUR_MS
    ) {
      return;
    }
    if (isScreeningExempt(guild, member.id, [...member.roles.cache.keys()])) {
      return;
    }

    await this.service.recordAutomodBlock({
      guildId: guild.id,
      userId: execution.userId,
      channelId: execution.channelId,
      alertMessageId: execution.alertSystemMessageId,
      ruleName: await this.ruleName(execution),
      content: execution.content,
      joinedAt: member.joinedAt,
    });
  }

  private async ruleName(
    execution: AutoModerationActionExecution,
  ): Promise<string> {
    if (execution.autoModerationRule) {
      return execution.autoModerationRule.name;
    }

    try {
      const rule = await execution.guild.autoModerationRules.fetch(
        execution.ruleId,
      );
      return rule.name;
    } catch (err) {
      // The name is only a label; losing the block record over it would cost recall data.
      this.logger.debug(
        { err, guildId: execution.guild.id, ruleId: execution.ruleId },
        "AutoMod rule fetch failed, using fallback name",
      );
      return FALLBACK_RULE_NAME;
    }
  }
}
