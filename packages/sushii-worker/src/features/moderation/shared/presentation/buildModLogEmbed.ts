import type { APIEmbedField, User } from "discord.js";
import { EmbedBuilder, TimestampStyles } from "discord.js";
import type { Client } from "discord.js";

import type { TimeoutChange } from "@/features/moderation/audit-logs/domain/value-objects/TimeoutChange";
import logger from "@/shared/infrastructure/logger";
import Color from "@/utils/colors";
import toTimestamp from "@/utils/toTimestamp";
import { getCleanFilename } from "@/utils/url";

import { ActionType } from "../domain/value-objects/ActionType";

interface ModCase {
  case_id: string;
  executor_id: string | null;
  reason: string | null;
  attachments: string[];
}

export default async function buildModLogEmbed(
  client: Client,
  actionType: ActionType,
  targetUser: User,
  modCase: ModCase,
  timeoutChange?: TimeoutChange,
): Promise<EmbedBuilder> {
  let executorUser;
  if (modCase.executor_id) {
    try {
      executorUser = await client.users.fetch(modCase.executor_id);
    } catch (err) {
      logger.warn(err, "Failed to fetch mod log executor user");
    }
  }

  if (!executorUser) {
    // sushii as default, or if executor failed to fetch
    executorUser = client.user;
  }

  if (!executorUser) {
    throw new Error("Missing executor user for mod log embed");
  }

  const fields: APIEmbedField[] = [];

  fields.push({
    name: `User ${actionType}`,
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
      if (timeoutChange.newTimestamp && timeoutChange.duration) {
        const newTsR = toTimestamp(
          timeoutChange.newTimestamp,
          TimestampStyles.RelativeTime,
        );
        const dur = timeoutChange.duration.humanize();

        fields.push({
          name: "Timeout Duration",
          value: `${dur}\nExpiring ${newTsR}`,
          inline: false,
        });
      }
    }

    if (timeoutChange.actionType === ActionType.TimeoutAdjust) {
      if (
        timeoutChange.newTimestamp &&
        timeoutChange.oldTimestamp &&
        timeoutChange.duration
      ) {
        const newTsR = toTimestamp(
          timeoutChange.newTimestamp,
          TimestampStyles.RelativeTime,
        );
        const oldTsR = toTimestamp(
          timeoutChange.oldTimestamp,
          TimestampStyles.RelativeTime,
        );
        const dur = timeoutChange.duration.humanize();

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
    }

    if (timeoutChange.actionType === ActionType.TimeoutRemove) {
      if (timeoutChange.oldTimestamp) {
        const oldTsR = toTimestamp(
          timeoutChange.oldTimestamp,
          TimestampStyles.RelativeTime,
        );

        fields.push({
          name: "Removed Timeout",
          value: `Would have expired ${oldTsR}`,
          inline: false,
        });
      }
    }
  }

  if (modCase.attachments.length > 0) {
    const attachments = modCase.attachments.filter((a): a is string => !!a);

    fields.push({
      name: "Attachments",
      value: attachments
        .map((a) => `[${getCleanFilename(a)}](${a})`)
        .join("\n")
        .slice(0, 1024),
      inline: false,
    });
  }

  const color = Color.Info;

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
