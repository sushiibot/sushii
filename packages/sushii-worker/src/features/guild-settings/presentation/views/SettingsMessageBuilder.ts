import type {
  CacheType,
  Interaction,
  InteractionReplyOptions,
} from "discord.js";
import { ContainerBuilder, MessageFlags } from "discord.js";

import Color from "@/utils/colors";

import { createFooter } from "./components/SettingsComponents";
import type { SettingsMessageOptions } from "./components/SettingsConstants";
import { addTabRows } from "./components/SettingsChrome";
import { addAutomodContent } from "./pages/AutomodPageBuilder";
import { addLoggingContent } from "./pages/LoggingPageBuilder";
import { addLookupContent } from "./pages/LookupPageBuilder";
import { addMessagesContent } from "./pages/MessagesPageBuilder";
import { addModDmsContent } from "./pages/ModDmsPageBuilder";
import { addModerationContent } from "./pages/ModerationPageBuilder";
import { addMoreContent } from "./pages/MorePageBuilder";
import { addOverviewContent } from "./pages/OverviewPageBuilder";

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
    case "overview":
      addOverviewContent(container, options, interaction);
      break;
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
    case "more":
      addMoreContent(container, options, interaction);
      break;
  }

  // Add tab bar navigation
  addTabRows(container, options.page, options.disabled ?? false);

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
