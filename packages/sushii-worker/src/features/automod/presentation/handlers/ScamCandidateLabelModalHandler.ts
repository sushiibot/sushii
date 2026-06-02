import type { ModalSubmitInteraction } from "discord.js";

import ModalHandler from "@/shared/presentation/handlers/ModalHandler";

import type { ScamCandidateService } from "../../application/ScamCandidateService";
import { parseModalId } from "./scamCandidateCustomIds";

export class ScamCandidateLabelModalHandler extends ModalHandler {
  customIDMatch = (customId: string) =>
    parseModalId(customId) !== null ? { path: customId, index: 0, params: {} } : false;

  constructor(private readonly service: ScamCandidateService) {
    super();
  }

  async handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    const reviewId = parseModalId(interaction.customId);
    if (reviewId === null) {
      return;
    }
    await this.service.handleLabelModal(reviewId, interaction);
  }
}
