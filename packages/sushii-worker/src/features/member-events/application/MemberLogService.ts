import type { GuildMember, PartialGuildMember } from "discord.js";
import {
  DiscordAPIError,
  EmbedBuilder,
  RESTJSONErrorCodes,
  TimestampStyles,
} from "discord.js";
import type { Logger } from "pino";

import dayjs from "@/shared/domain/dayjs";
import type { GuildConfig } from "@/shared/domain/entities/GuildConfig";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";
import Color from "@/utils/colors";
import toTimestamp from "@/utils/toTimestamp";

export class MemberLogService {
  constructor(
    private readonly guildConfigRepository: GuildConfigRepository,
    private readonly logger: Logger,
  ) {}

  async logMemberJoin(member: GuildMember): Promise<void> {
    await this.logMember(member, "join");
  }

  async logMemberLeave(
    member: GuildMember | PartialGuildMember,
  ): Promise<void> {
    await this.logMember(member, "leave");
  }

  private async logMember(
    member: GuildMember | PartialGuildMember,
    action: "join" | "leave",
  ): Promise<void> {
    const config = await this.guildConfigRepository.findByGuildId(
      member.guild.id,
    );

    if (
      !config.loggingSettings.memberLogEnabled ||
      !config.loggingSettings.memberLogChannel
    ) {
      return;
    }

    const channel = member.guild.channels.cache.get(
      config.loggingSettings.memberLogChannel,
    );
    if (!channel || !channel.isTextBased()) {
      return;
    }

    const embed = this.buildMemberLogEmbed(member, action);

    try {
      await channel.send({ embeds: [embed] });
    } catch (err) {
      if (!(err instanceof DiscordAPIError)) {
        throw err;
      }

      // Channel was deleted or something
      if (err.code === RESTJSONErrorCodes.UnknownChannel) {
        // Remove channel from config
        await this.removeMemberLogChannel(config);
      }

      if (err.code === RESTJSONErrorCodes.MissingAccess) {
        // No permission to send to channel
        this.logger.debug(
          {
            err,
            channel: channel.id,
            guild: channel.guild.id,
            action,
          },
          "No permission to send to channel",
        );
      }
    }
  }

  private buildMemberLogEmbed(
    member: GuildMember | PartialGuildMember,
    action: "join" | "leave",
  ): EmbedBuilder {
    const name = member.nickname
      ? `${member.nickname} ~ ${member.user.displayName} (@${member.user.tag})`
      : `${member.user.displayName} (@${member.user.tag})`;

    let accountCreated = toTimestamp(dayjs.utc(member.user.createdAt));
    accountCreated += " ~ ";
    accountCreated += ` ${toTimestamp(
      dayjs.utc(member.user.createdAt),
      TimestampStyles.RelativeTime,
    )}`;

    const embed = new EmbedBuilder()
      .setAuthor({
        name,
        iconURL: member.user.displayAvatarURL(),
      })
      .setFooter({
        text: `ID: ${member.user.id}`,
      })
      .setTimestamp(new Date());

    // Always add account age
    embed.addFields({
      name: "Account created",
      value: accountCreated,
      inline: true,
    });

    if (action === "join") {
      embed
        .setColor(Color.Success)
        .setDescription(`${member.user.toString()} joined the server.`);
    } else {
      embed
        .setColor(Color.Error)
        .setDescription(`${member.user.toString()} left the server.`);

      if (member.joinedAt) {
        // Only add member age when leaving
        let memberAge = toTimestamp(dayjs.utc(member.joinedAt));
        memberAge += " ~ ";
        memberAge += toTimestamp(
          dayjs.utc(member.joinedAt),
          TimestampStyles.RelativeTime,
        );

        embed.addFields({
          name: "Joined server",
          value: memberAge,
          inline: true,
        });
      }

      if (member.roles.cache.size > 1) {
        embed.addFields([
          {
            name: "Roles",
            value: member.roles.cache.map((role) => role.toString()).join(", "),
          },
        ]);
      }
    }

    return embed;
  }

  private async removeMemberLogChannel(config: GuildConfig): Promise<void> {
    const updatedConfig = config.updateLogChannel("member", null);
    await this.guildConfigRepository.save(updatedConfig);
  }
}
