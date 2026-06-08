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
  expiresAt: Date,
): InteractionReplyOptions & { flags: number } {
  const container = new ContainerBuilder().setAccentColor(Color.Info);
  const expiresTs = Math.floor(expiresAt.getTime() / 1000);

  let text = isRefresh
    ? `## Message Updated\nThe previously saved record for this message has been updated.\n\n`
    : `## Message Saved\n\n`;

  text += `Share this code with the moderator if they requested it — expires <t:${expiresTs}:R>.\n\n`;
  text += `**\`${code}\`**\n\n`;
  text += `-# What was saved: the message text, author, timestamp, and any attachment filenames.\n`;
  text += `-# Nothing is sent to anyone automatically — a moderator needs this code to access it.\n`;
  text += `-# Only share this if a moderator explicitly asked for it.`;

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
