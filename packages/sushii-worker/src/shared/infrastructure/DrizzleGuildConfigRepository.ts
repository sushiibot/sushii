import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import { guildConfigsInAppPublic } from "@/infrastructure/database/schema";
import type * as schema from "@/infrastructure/database/schema";

import { GuildConfig } from "../domain/entities/GuildConfig";
import type { GuildConfigRepository } from "../domain/repositories/GuildConfigRepository";

export class DrizzleGuildConfigRepository implements GuildConfigRepository {
  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly logger: Logger,
  ) {}

  async findByGuildId(guildId: string): Promise<GuildConfig> {
    const result = await this.db
      .select()
      .from(guildConfigsInAppPublic)
      .where(eq(guildConfigsInAppPublic.id, BigInt(guildId)))
      .limit(1);

    const config = result[0];

    if (!config) {
      this.logger.debug(
        { guildId },
        "No guild configuration found, returning default",
      );
      return GuildConfig.createDefault(guildId);
    }

    return this.mapToEntity(config);
  }

  async save(configuration: GuildConfig): Promise<GuildConfig> {
    this.logger.debug(
      { guildId: configuration.guildId },
      "Saving guild configuration",
    );

    const data = this.mapToData(configuration);

    const result = await this.db
      .insert(guildConfigsInAppPublic)
      .values(data)
      .onConflictDoUpdate({
        target: guildConfigsInAppPublic.id,
        set: data,
      })
      .returning();

    return this.mapToEntity(result[0]);
  }

  private mapToEntity(
    data: typeof schema.guildConfigsInAppPublic.$inferSelect,
  ): GuildConfig {
    return new GuildConfig(
      data.id.toString(),
      data.prefix,
      {
        joinMessage: data.joinMsg,
        joinMessageEnabled: data.joinMsgEnabled ?? false,
        leaveMessage: data.leaveMsg,
        leaveMessageEnabled: data.leaveMsgEnabled ?? false,
        messageChannel: data.msgChannel ? data.msgChannel.toString() : null,
      },
      {
        modLogChannel: data.logMod ? data.logMod.toString() : null,
        modLogEnabled: data.logModEnabled ?? false,
        memberLogChannel: data.logMember ? data.logMember.toString() : null,
        memberLogEnabled: data.logMemberEnabled ?? false,
        messageLogChannel: data.logMsg ? data.logMsg.toString() : null,
        messageLogEnabled: data.logMsgEnabled ?? false,
        reactionLogChannel: data.logReaction
          ? data.logReaction.toString()
          : null,
        reactionLogEnabled: data.logReactionEnabled ?? false,
      },
      {
        timeoutDmText: data.timeoutDmText,
        timeoutCommandDmEnabled: data.timeoutCommandDmEnabled ?? true,
        timeoutNativeDmEnabled: data.timeoutNativeDmEnabled ?? true,
        warnDmText: data.warnDmText,
        banDmText: data.banDmText,
        banDmEnabled: data.banDmEnabled ?? true,
        lookupDetailsOptIn: data.lookupDetailsOptIn ?? false,
        lookupPrompted: data.lookupPrompted ?? false,
      },
      data.disabledChannels?.map((id) => id.toString()) ?? [],
    );
  }

  private mapToData(
    config: GuildConfig,
  ): typeof schema.guildConfigsInAppPublic.$inferInsert {
    return {
      id: BigInt(config.guildId),
      prefix: config.prefix,
      joinMsg: config.messageSettings.joinMessage,
      joinMsgEnabled: config.messageSettings.joinMessageEnabled,
      leaveMsg: config.messageSettings.leaveMessage,
      leaveMsgEnabled: config.messageSettings.leaveMessageEnabled,
      msgChannel: config.messageSettings.messageChannel
        ? BigInt(config.messageSettings.messageChannel)
        : null,
      logMod: config.loggingSettings.modLogChannel
        ? BigInt(config.loggingSettings.modLogChannel)
        : null,
      logModEnabled: config.loggingSettings.modLogEnabled,
      logMember: config.loggingSettings.memberLogChannel
        ? BigInt(config.loggingSettings.memberLogChannel)
        : null,
      logMemberEnabled: config.loggingSettings.memberLogEnabled,
      logMsg: config.loggingSettings.messageLogChannel
        ? BigInt(config.loggingSettings.messageLogChannel)
        : null,
      logMsgEnabled: config.loggingSettings.messageLogEnabled,
      logReaction: config.loggingSettings.reactionLogChannel
        ? BigInt(config.loggingSettings.reactionLogChannel)
        : null,
      logReactionEnabled: config.loggingSettings.reactionLogEnabled,
      timeoutDmText: config.moderationSettings.timeoutDmText,
      timeoutCommandDmEnabled:
        config.moderationSettings.timeoutCommandDmEnabled,
      timeoutNativeDmEnabled: config.moderationSettings.timeoutNativeDmEnabled,
      warnDmText: config.moderationSettings.warnDmText,
      banDmText: config.moderationSettings.banDmText,
      banDmEnabled: config.moderationSettings.banDmEnabled,
      lookupDetailsOptIn: config.moderationSettings.lookupDetailsOptIn,
      lookupPrompted: config.moderationSettings.lookupPrompted,
      disabledChannels: config.disabledChannels.map(BigInt),
    };
  }
}
