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
  TextDisplayBuilder,
} from "discord.js";

import Color from "@/utils/colors";

import {
  createFooter,
  createNavigationDropdown,
} from "./components/SettingsComponents";
import type { SettingsMessageOptions } from "./components/SettingsConstants";
import { addAutomodContent } from "./pages/AutomodPageBuilder";
import { addLoggingContent } from "./pages/LoggingPageBuilder";
import { addLookupContent } from "./pages/LookupPageBuilder";
import { addMessagesContent } from "./pages/MessagesPageBuilder";
import { addModDmsContent } from "./pages/ModDmsPageBuilder";
import { addModerationContent } from "./pages/ModerationPageBuilder";

export function createSettingsMessage(
  options: SettingsMessageOptions,
  interaction?: Interaction<CacheType>,
): InteractionReplyOptions & {
  flags: MessageFlags.IsComponentsV2;
  components: ContainerBuilder[];
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
    case "lookup":
      addLookupContent(container, options, interaction);
      break;
    case "mod-dms":
      addModDmsContent(container, options, interaction);
      break;
    case "automod":
      addAutomodContent(container, options, interaction);
      break;
    case "messages":
      addMessagesContent(container, options, interaction);
      break;
  }

  // Add navigation dropdown
  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("-# Navigate between settings pages"),
  );

  const navigationRow = createNavigationDropdown(options.page, options.disabled);
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
