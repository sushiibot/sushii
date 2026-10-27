import type { BotEmojiRepository } from "@/features/bot-emojis/domain/repositories/BotEmojiRepository";
import type { CommandMentions } from "@/shared/presentation/commandMentions";

import { HelpCommand } from "./presentation/HelpCommand";
import { HelpRenderer } from "./presentation/HelpRenderer";
import { HelpSearchAutocomplete } from "./presentation/HelpSearchAutocomplete";
import { HelpTabButtonHandler } from "./presentation/HelpTabButtonHandler";
import type { CommandListProvider } from "./presentation/helpVisibility";

interface SetupParams {
  commandList: CommandListProvider;
  emojiRepository: BotEmojiRepository;
  commandMentions: CommandMentions;
}

export function setupHelpFeature({
  commandList,
  emojiRepository,
  commandMentions,
}: SetupParams) {
  const renderer = new HelpRenderer(
    commandList,
    emojiRepository,
    commandMentions,
  );

  return {
    commands: [new HelpCommand(renderer)],
    buttonHandlers: [new HelpTabButtonHandler(renderer)],
    autocompleteHandlers: [new HelpSearchAutocomplete(commandList)],
  };
}
