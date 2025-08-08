import type { APIEmbed } from "discord.js";

import type { SlowmodeUpdateResult } from "@/features/moderation/management/application/SlowmodeService";
import Color from "@/utils/colors";

export function slowmodeErrorView(error: string): APIEmbed {
  return {
    title: "Error",
    description: error,
    color: Color.Error,
  };
}

export function slowmodeSuccessView(result: SlowmodeUpdateResult): APIEmbed {
  return {
    title: "Updated slowmode",
    fields: [
      {
        name: "Channel",
        value: `<#${result.channelId}>`,
        inline: true,
      },
      {
        name: "Previous Duration",
        value: result.previousSlowmode.toString(),
        inline: true,
      },
      {
        name: "New Duration",
        value: result.newSlowmode.toString(),
        inline: true,
      },
    ],
    color: Color.Success,
  };
}
