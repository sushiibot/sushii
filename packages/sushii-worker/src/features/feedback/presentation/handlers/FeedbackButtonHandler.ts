import type { ButtonInteraction } from "discord.js";

import { ButtonHandler } from "@/shared/presentation/handlers";

import { parseButtonId } from "../customIds";
import { buildFeedbackModal } from "../views/FeedbackModal";

export class FeedbackButtonHandler extends ButtonHandler {
  customIDMatch = (customId: string) =>
    parseButtonId(customId) !== null
      ? { path: customId, index: 0, params: {} }
      : false;

  async handleInteraction(interaction: ButtonInteraction): Promise<void> {
    const id = parseButtonId(interaction.customId);
    if (!id) {
      return;
    }

    if (id.source === "panel") {
      await interaction.showModal(buildFeedbackModal(id));
      return;
    }

    // Public error replies can be clicked by anyone; only the invoker's feedback is tied to the trace.
    const isInvoker = id.invokerId === interaction.user.id;
    await interaction.showModal(
      buildFeedbackModal({
        source: "error_report",
        traceId: isInvoker ? id.traceId : null,
      }),
    );
  }
}
