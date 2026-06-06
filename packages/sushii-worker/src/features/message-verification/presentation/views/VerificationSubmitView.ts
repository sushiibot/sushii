import type { InteractionReplyOptions } from "discord.js";
import {
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
} from "discord.js";
import Color from "@/utils/colors";

export function createVerificationSubmitMessage(
  code: string,
  isRefresh: boolean,
): InteractionReplyOptions & { flags: number } {
  const container = new ContainerBuilder().setAccentColor(Color.Info);

  let text = isRefresh
    ? `## Record Refreshed\nYour previously submitted message has been updated.\n\n`
    : `## Message Submitted\n\n`;

  text += `**Lookup Code**\n\`${code}\`\n\n`;
  text += `-# This code is only useful if a moderator explicitly requested it for report verification. Nothing will happen if you share it with anyone else.`;

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(text),
  );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  };
}

export function createVerificationSubmitErrorMessage(): InteractionReplyOptions & {
  flags: number;
} {
  const container = new ContainerBuilder().setAccentColor(Color.Error);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "## Error\nSomething went wrong while submitting the message. Please try again later.",
    ),
  );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  };
}
