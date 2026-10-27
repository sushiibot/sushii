import type { ButtonInteraction } from "discord.js";

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
    const audience = parseHelpTabId(interaction.customId);
    if (!audience) {
      throw new Error("Unexpected help tab custom ID", {
        cause: interaction.customId,
      });
    }

    const payload = await this.renderer.render(
      audience,
      interaction.memberPermissions,
      interaction.guildId ?? undefined,
    );

    await interaction.update(payload);
  }
}
