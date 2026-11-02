import type { ButtonInteraction } from "discord.js";

import { ButtonHandler } from "@/shared/presentation/handlers";

import type { IpGrabberReviewService } from "../../application/IpGrabberReviewService";
import { parseRevertId } from "../views/ipGrabberCustomIds";

export class IpGrabberRevertButtonHandler extends ButtonHandler {
  customIDMatch = (customId: string) =>
    parseRevertId(customId) !== null
      ? { path: customId, index: 0, params: {} }
      : false;

  constructor(private readonly reviewService: IpGrabberReviewService) {
    super();
  }

  async handleInteraction(interaction: ButtonInteraction): Promise<void> {
    const hostname = parseRevertId(interaction.customId);
    if (hostname === null) {
      return;
    }

    await this.reviewService.handleRevert(hostname, interaction);
  }
}
