import type { InteractionReplyOptions } from "discord.js";
import {
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} from "discord.js";
import Color from "@/utils/colors";

export function createVerificationGuideMessage(
  installUrl: string,
): InteractionReplyOptions & {
  flags: number;
} {
  const container = new ContainerBuilder().setAccentColor(Color.Info);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        "## Message Verification Guide",
        "Screenshots and screen recordings can be edited or faked. Message verification lets users submit message data directly through Discord — giving you author, content, and timestamp sourced from Discord itself, not a screenshot.",
      ].join("\n"),
    ),
  );

  container.addSeparatorComponents(new SeparatorBuilder());

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        "### Suggested Workflow",
        "Ask the reporting user for both:",
        "- **Screen recording or screenshots** — provides surrounding context and conversation flow",
        "- **Message verification codes** for specific messages — confirms those messages are real",
        "",
        "Screen recordings and screenshots still have value as context. Verification just removes doubt about whether individual messages were fabricated.",
      ].join("\n"),
    ),
  );

  container.addSeparatorComponents(new SeparatorBuilder());

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        "### How to Request Verification",
        "Run `/verify-message code:<code>` to display the verified record once you have a code.",
        "",
        "-# Codes don't expire. Any mod can look up any code. Works in servers, DMs, and group DMs.",
      ].join("\n"),
    ),
  );

  container.addSeparatorComponents(new SeparatorBuilder());

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        "### Suggested Message to Send",
        "Copy and send this to the user you're requesting verification from:",
        "```",
        "To verify a message for our moderation team:",
        `1. Install sushii as a user app (required for DMs): ${installUrl}`,
        "2. Right-click the message → Apps → Submit to Mods",
        "3. Send me the 8-character code you receive",
        "```",
      ].join("\n"),
    ),
  );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  };
}
