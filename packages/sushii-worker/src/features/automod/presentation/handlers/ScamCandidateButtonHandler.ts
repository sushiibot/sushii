import type { ButtonInteraction } from "discord.js";

import { ButtonHandler } from "@/shared/presentation/handlers";

import type { ScamCandidateService } from "../../application/ScamCandidateService";
import { parseAddId, parseIgnoreId, parseRevertId } from "./scamCandidateCustomIds";

export class ScamCandidateButtonHandler extends ButtonHandler {
  customIDMatch = (customId: string) =>
    parseIgnoreId(customId) !== null || parseAddId(customId) !== null || parseRevertId(customId) !== null
      ? { path: customId, index: 0, params: {} }
      : false;

  constructor(private readonly service: ScamCandidateService) {
    super();
  }

  async handleInteraction(interaction: ButtonInteraction): Promise<void> {
    const ignoreId = parseIgnoreId(interaction.customId);
    if (ignoreId !== null) {
      await this.service.handleIgnore(ignoreId, interaction);
      return;
    }

    const addId = parseAddId(interaction.customId);
    if (addId !== null) {
      await this.service.handleAdd(addId, interaction);
      return;
    }

    const revertId = parseRevertId(interaction.customId);
    if (revertId !== null) {
      await this.service.handleRevert(revertId, interaction);
    }
  }
}
