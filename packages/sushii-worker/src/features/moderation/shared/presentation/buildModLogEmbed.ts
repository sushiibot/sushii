import type { APIEmbedField, User } from "discord.js";
import { EmbedBuilder, TimestampStyles } from "discord.js";
import type { Client } from "discord.js";

import type { TimeoutChange } from "@/features/moderation/audit-logs/domain/value-objects/TimeoutChange";
import logger from "@/shared/infrastructure/logger";
import dayjs from "@/shared/domain/dayjs";
import Color from "@/utils/colors";
import toTimestamp from "@/utils/toTimestamp";
import { getCleanFilename } from "@/utils/url";

import { ActionType } from "../domain/value-objects/ActionType";
import {
  formatActionType,
  getActionTypeColor,
} from "./views/ActionTypeFormatter";

interface ModCase {
  case_id: string;
  executor_id: string | null;
  reason: string | null;
  attachments: string[];
  /** Duration in seconds (for tempban/timeout cases) */
  timeout_duration?: number | null;
  /** When the moderation action was taken */
  action_time?: Date | null;
  /** Delete message duration in seconds (for softban cases) */
  delete_message_seconds?: number | null;
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
    name: `User ${formatActionType(actionType)}`,
    value: `<@${targetUser.id}> ${targetUser.displayName} (\`@${targetUser.tag}\`) | \`${targetUser.id}\``,
    inline: false,
  });

  fields.push({
    name: "Reason",
    value: modCase.reason || "No reason provided.",
    inline: false,
  });

  // Add tempban duration and expiry
  if (
    actionType === ActionType.TempBan &&
    modCase.timeout_duration &&
    modCase.action_time
  ) {
    const dur = dayjs.duration(modCase.timeout_duration, "seconds");
    const expiryTs = toTimestamp(
      dayjs(modCase.action_time).add(modCase.timeout_duration, "seconds"),
      TimestampStyles.RelativeTime,
    );

    fields.push({
      name: "Ban Duration",
      value: `${dur.humanize()}\nExpiring ${expiryTs}`,
      inline: false,
    });
  }

  // Add softban deleted messages duration
  if (actionType === ActionType.Softban && modCase.delete_message_seconds != null) {
    const value =
      modCase.delete_message_seconds === 0
        ? "None"
        : dayjs.duration(modCase.delete_message_seconds, "seconds").humanize();
    fields.push({
      name: "Deleted Messages",
      value,
      inline: false,
    });
  }

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

  const color = getActionTypeColor(actionType) || Color.Info;

  return new EmbedBuilder()
    .setAuthor({
      name: executorUser.tag,
      iconURL:
        executorUser.displayAvatarURL?.() ||
        `https://cdn.discordapp.com/avatars/${executorUser.id}/avatar.png`,
    })
    .setFields(fields)
    .setColor(color)
    .setFooter({
      text: `Case #${modCase.case_id}`,
    })
    .setImage(modCase.attachments.at(0) || null)
    .setTimestamp(new Date());
}
