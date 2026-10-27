import type { PermissionsBitField } from "discord.js";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain/repositories/BotEmojiRepository";
import type { CommandMentions } from "@/shared/presentation/commandMentions";

import { buildHelpIndex } from "../application/helpIndex";
import type { HelpAudience } from "../domain/helpCatalog";
import { HELP_EMOJI_NAMES } from "../domain/helpCatalog";
import type { CommandListProvider } from "./helpVisibility";
import { resolveVisibleHelp } from "./helpVisibility";
import { buildHelpDetail } from "./views/HelpDetailView";
import { buildHelpPage } from "./views/HelpView";

export type HelpPayload = ReturnType<typeof buildHelpPage>;

export class HelpRenderer {
  constructor(
    private readonly commandList: CommandListProvider,
    private readonly emojiRepository: BotEmojiRepository,
    private readonly mentions: CommandMentions,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async render(
    requested: HelpAudience,
    memberPermissions: Readonly<PermissionsBitField> | null,
    guildId: string | undefined,
  ): Promise<HelpPayload> {
    const visible = resolveVisibleHelp(this.commandList(), memberPermissions);
    const audience = visible.audiences.includes(requested)
      ? requested
      : "members";
    const emojis = await this.emojiRepository.getEmojis(HELP_EMOJI_NAMES);

    return buildHelpPage({
      audience,
      visible,
      emojis,
      mentions: this.mentions,
      guildId,
      now: this.now(),
    });
  }

  async renderDetail(
    query: string,
    memberPermissions: Readonly<PermissionsBitField> | null,
    guildId: string | undefined,
  ): Promise<HelpPayload> {
    const emojis = await this.emojiRepository.getEmojis(HELP_EMOJI_NAMES);

    return buildHelpDetail({
      query,
      entries: buildHelpIndex(this.commandList()),
      memberPermissions,
      emojis,
      mentions: this.mentions,
      guildId,
    });
  }
}
