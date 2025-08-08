import type {
  Events,
  GuildMember,
  PartialGuildMember} from "discord.js";
import {
  DiscordAPIError,
  EmbedBuilder,
  RESTJSONErrorCodes,
  TimestampStyles,
} from "discord.js";

import dayjs from "@/shared/domain/dayjs";
import { newModuleLogger } from "@/shared/infrastructure/logger";

import {
  getGuildConfig,
  upsertGuildConfig,
} from "../db/GuildConfig/GuildConfig.repository";
import db from "../infrastructure/database/db";
import Color from "../utils/colors";
import toTimestamp from "../utils/toTimestamp";
import type { EventHandlerFn } from "./EventHandler";

const log = newModuleLogger("MemberLog");

async function logMember(
  member: GuildMember | PartialGuildMember,
  action: "join" | "leave",
): Promise<void> {
  const conf = await getGuildConfig(db, member.guild.id);

  if (!conf.log_member_enabled || !conf.log_member) {
    return;
  }

  const channel = member.guild.channels.cache.get(conf.log_member);
  if (!channel || !channel.isTextBased()) {
    return;
  }

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

  try {
    await channel.send({ embeds: [embed] });
  } catch (err) {
    if (!(err instanceof DiscordAPIError)) {
      throw err;
    }

    // Channel was deleted or something
    if (err.code === RESTJSONErrorCodes.UnknownChannel) {
      // Remove channel from config
      conf.log_member = null;
      await upsertGuildConfig(db, conf);
    }

    if (err.code === RESTJSONErrorCodes.MissingAccess) {
      // No permission to send to channel
      log.debug(
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

export const memberLogJoinHandler: EventHandlerFn<
  Events.GuildMemberAdd
> = async (member: GuildMember): Promise<void> => {
  await logMember(member, "join");
};

export const memberLogLeaveHandler: EventHandlerFn<
  Events.GuildMemberRemove
> = async (member: GuildMember | PartialGuildMember): Promise<void> => {
  await logMember(member, "leave");
};
