import type {
  CacheType,
  Interaction,
  InteractionReplyOptions,
} from "discord.js";
import {
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
} from "discord.js";

import Color from "@/utils/colors";

import {
  createFooter,
  createNavigationRow,
} from "./components/SettingsComponents";
import type { SettingsMessageOptions } from "./components/SettingsConstants";
import { addAdvancedContent } from "./pages/AdvancedPageBuilder";
import { addLoggingContent } from "./pages/LoggingPageBuilder";
import { addMessagesContent } from "./pages/MessagesPageBuilder";
import { addModerationContent } from "./pages/ModerationPageBuilder";

export function createSettingsMessage(
  options: SettingsMessageOptions,
  interaction?: Interaction<CacheType>,
): InteractionReplyOptions & {
  flags: MessageFlags.IsComponentsV2;
} {
  const container = new ContainerBuilder().setAccentColor(Color.Info);

  // Add page-specific content
  switch (options.page) {
    case "logging":
      addLoggingContent(container, options, interaction);
      break;
    case "moderation":
      addModerationContent(container, options, interaction);
      break;
    case "messages":
      addMessagesContent(container, options, interaction);
      break;
    case "advanced":
      addAdvancedContent(container, options, interaction);
      break;
  }

  // Add navigation dropdown
  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
  );

  const navigationRow = createNavigationRow(options.page, options.disabled);
  container.addActionRowComponents(navigationRow);

  // Add footer (after navigation)
  const footerText = createFooter(options.disabled);
  container.addTextDisplayComponents(footerText);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: {
      parse: [],
    },
  };
}

export function formatButtonRejectionResponse(): {
  content: string;
  ephemeral: boolean;
} {
  return {
    content: "Only the person who ran the command can use these buttons.",
    ephemeral: true,
  };
}
