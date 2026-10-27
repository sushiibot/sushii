import type { ButtonInteraction } from "discord.js";
import { MessageFlags } from "discord.js";

import { ButtonHandler } from "@/shared/presentation/handlers";

import type { HelpRenderer } from "./HelpRenderer";
import { parseHelpTabId } from "./helpIds";

/** Stateless so tabs on old /help messages keep working across restarts. */
export class HelpTabButtonHandler extends ButtonHandler {
  readonly customIDMatch = (customId: string) =>
    parseHelpTabId(customId) !== null
      ? { path: customId, params: {} }
      : (false as const);

  constructor(private readonly renderer: HelpRenderer) {
    super();
  }

  async handleInteraction(interaction: ButtonInteraction): Promise<void> {
    const target = parseHelpTabId(interaction.customId);
    if (!target) {
      throw new Error("Unexpected help tab custom ID", {
        cause: interaction.customId,
      });
    }

    const payload = await this.renderer.render(
      target.audience,
      interaction.memberPermissions,
      interaction.guildId ?? undefined,
      interaction.user.id,
    );

    const isOwner =
      target.ownerId === null || target.ownerId === interaction.user.id;
    if (isOwner) {
      await interaction.update(payload);
      return;
    }

    await interaction.reply({
      ...payload,
      flags: payload.flags | MessageFlags.Ephemeral,
    });
  }
}
