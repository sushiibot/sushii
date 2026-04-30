import type { InteractionReplyOptions, InteractionUpdateOptions } from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
} from "discord.js";

import Color from "@/utils/colors";

import type { PromptContent } from "../../domain/PromptDefinition";
import { makeCustomId } from "../customIds";

type ComponentsV2Reply = InteractionReplyOptions & { flags: MessageFlags.IsComponentsV2 };
type ComponentsV2Update = InteractionUpdateOptions & { flags: MessageFlags.IsComponentsV2 };

export function buildPromptMessage(
  content: PromptContent,
  promptId: string,
  snoozeEnabled: boolean,
): ComponentsV2Reply {
  const container = new ContainerBuilder().setAccentColor(
    content.accentColor ?? Color.Info,
  );
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content.text));

  if (content.actionRow) {
    container.addActionRowComponents(content.actionRow);
  }

  const buttons: ButtonBuilder[] = [];
  if (snoozeEnabled) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(makeCustomId(promptId, "snooze"))
        .setLabel("Remind me in 7 days")
        .setStyle(ButtonStyle.Secondary),
    );
  }
  buttons.push(
    new ButtonBuilder()
      .setCustomId(makeCustomId(promptId, "dismiss"))
      .setLabel("Don't show again")
      .setStyle(ButtonStyle.Secondary),
  );

  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons),
  );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

export function buildSnoozedMessage(): ComponentsV2Update {
  const container = new ContainerBuilder().setAccentColor(Color.DiscordGrey);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("-# Got it — will remind you in 7 days."),
  );
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

export function buildDismissedMessage(): ComponentsV2Update {
  const container = new ContainerBuilder().setAccentColor(Color.DiscordGrey);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("-# Got it, won't ask again."),
  );
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}
