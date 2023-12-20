import { APIEmbedField, EmbedBuilder, TimestampStyles, User } from "discord.js";
import path from "path";
import { ActionType } from "../interactions/moderation/ActionType";
import Context from "../model/context";
import logger from "../logger";
import toTimestamp from "../utils/toTimestamp";
import { TimeoutChange } from "../types/TimeoutChange";

interface ModCase {
  case_id: string;
  executor_id: string | null;
  reason: string | null;
  attachments: string[];
}

export default async function buildModLogEmbed(
  ctx: Context,
  actionType: ActionType,
  targetUser: User,
  modCase: ModCase,
  timeoutChange?: TimeoutChange,
): Promise<EmbedBuilder> {
  let executorUser;
  if (modCase.executor_id) {
    try {
      executorUser = await ctx.client.users.fetch(modCase.executor_id);
    } catch (err) {
      logger.warn(err, "Failed to fetch mod log executor user");
    }
  }

  if (!executorUser) {
    // sushii as default, or if executor failed to fetch
    executorUser = ctx.client.user;
  }

  if (!executorUser) {
    throw new Error("Missing executor user for mod log embed");
  }

  const fields: APIEmbedField[] = [];

  fields.push({
    name: `User ${ActionType.toString(actionType)}`,
    value: `<@${targetUser.id}> ${targetUser.displayName} (\`@${targetUser.tag}\`) | \`${targetUser.id}\``,
    inline: false,
  });

  fields.push({
    name: "Reason",
    value: modCase.reason || "No reason provided.",
    inline: false,
  });

  if (timeoutChange) {
    if (timeoutChange.actionType === ActionType.Timeout) {
      const newTsR = toTimestamp(
        timeoutChange.new,
        TimestampStyles.RelativeTime,
      );
      const dur = timeoutChange.duration.humanize();

      fields.push({
        name: "Timeout Duration",
        value: `${dur}\nExpiring ${newTsR}`,
        inline: false,
      });
    }

    if (timeoutChange.actionType === ActionType.TimeoutAdjust) {
      const newTsR = toTimestamp(
        timeoutChange.new,
        TimestampStyles.RelativeTime,
      );
      const dur = timeoutChange.duration.humanize();

      const oldTsR = toTimestamp(
        timeoutChange.old,
        TimestampStyles.RelativeTime,
      );

      fields.push(
        {
          name: "Timeout Duration",
          value: `${dur}\nExpiring ${newTsR}`,
          inline: false,
        },
        {
          name: "Previous Timeout",
          value: `Would have expired ${oldTsR}`,
          inline: false,
        },
      );
    }

    if (timeoutChange.actionType === ActionType.TimeoutRemove) {
      const oldTsR = toTimestamp(
        timeoutChange.old,
        TimestampStyles.RelativeTime,
      );

      fields.push({
        name: "Removed Timeout",
        value: `Would have expired ${oldTsR}`,
        inline: false,
      });
    }
  }

  if (modCase.attachments.length > 0) {
    const attachments = modCase.attachments.filter((a): a is string => !!a);

    fields.push({
      name: "Attachments",
      value: attachments
        .map((a) => `[${path.basename(a)}](${a})`)
        .join("\n")
        .slice(0, 1024),
      inline: false,
    });
  }

  const color = ActionType.toColor(actionType);

  return new EmbedBuilder()
    .setAuthor({
      name: executorUser.tag,
      iconURL: executorUser.displayAvatarURL(),
    })
    .setFields(fields)
    .setColor(color)
    .setFooter({
      text: `Case #${modCase.case_id}`,
    })
    .setImage(modCase.attachments.at(0) || null)
    .setTimestamp(new Date());
}
