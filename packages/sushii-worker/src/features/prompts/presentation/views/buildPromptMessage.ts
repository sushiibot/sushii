import type {
  InteractionReplyOptions,
  InteractionUpdateOptions,
} from "discord.js";
import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
} from "discord.js";

import Color from "@/utils/colors";

import type { PromptContent } from "../../domain/PromptDefinition";
import { makeCustomId } from "../customIds";

type PromptReply = InteractionReplyOptions & {
  flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
};
type ComponentsV2Update = InteractionUpdateOptions & {
  flags: MessageFlags.IsComponentsV2;
};

export function buildPromptMessage(content: PromptContent): PromptReply {
  const container = new ContainerBuilder().setAccentColor(
    content.accentColor ?? Color.Info,
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(content.text),
  );
  for (const row of content.rows ?? []) {
    container.addActionRowComponents(row);
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  };
}

export function snoozeButton(promptId: string, days: number): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(makeCustomId(promptId, "snooze"))
    .setLabel(`Remind me in ${days} days`)
    .setStyle(ButtonStyle.Secondary);
}

export function dismissButton(promptId: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(makeCustomId(promptId, "dismiss"))
    .setLabel("Don't show again")
    .setStyle(ButtonStyle.Secondary);
}

function noteMessage(text: string): ComponentsV2Update {
  const container = new ContainerBuilder().setAccentColor(Color.DiscordGrey);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

export function buildSnoozedMessage(days: number): ComponentsV2Update {
  return noteMessage(`-# Got it, I'll remind you in ${days} days.`);
}

export function buildDismissedMessage(): ComponentsV2Update {
  return noteMessage("-# Got it, won't ask again.");
}

export function buildNotAllowedMessage(): InteractionReplyOptions & {
  flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
} {
  const container = new ContainerBuilder().setAccentColor(Color.Error);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "You no longer have permission to do this.",
    ),
  );
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  };
}
