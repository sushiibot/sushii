import {
  ContainerBuilder,
  InteractionReplyOptions,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from "discord.js";

import Color from "@/utils/colors";

import {
  createFooter,
  createNavigationRow,
} from "./components/SettingsComponents";
import { SettingsMessageOptions } from "./components/SettingsConstants";
import { addAdvancedContent } from "./pages/AdvancedPageBuilder";
import { addLoggingContent } from "./pages/LoggingPageBuilder";
import { addMessagesContent } from "./pages/MessagesPageBuilder";
import { addModerationContent } from "./pages/ModerationPageBuilder";

export function createSettingsMessage(
  options: SettingsMessageOptions,
): InteractionReplyOptions & {
  flags: MessageFlags.IsComponentsV2;
} {
  const container = new ContainerBuilder().setAccentColor(Color.Info);

  // Add page-specific content
  switch (options.page) {
    case "logging":
      addLoggingContent(container, options);
      break;
    case "moderation":
      addModerationContent(container, options);
      break;
    case "messages":
      addMessagesContent(container, options);
      break;
    case "advanced":
      addAdvancedContent(container, options);
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
    content: "These buttons aren't for you! 😡",
    ephemeral: true,
  };
}
