import type {
  ButtonInteraction,
  ModalBuilder,
  ModalMessageModalSubmitInteraction,
} from "discord.js";
import { DiscordjsError, DiscordjsErrorCodes } from "discord.js";

import { parseSettingsId } from "./settingsIds";

const DEFAULT_MODAL_TIME_MS = 5 * 60 * 1000;

// Unscoped collector with only `time` set: InteractionCollectorError can only mean timeout.
function isCollectorTimeout(err: unknown): boolean {
  return (
    err instanceof DiscordjsError &&
    err.code === DiscordjsErrorCodes.InteractionCollectorError
  );
}

export async function openSettingsModal(
  interaction: ButtonInteraction<"cached">,
  modal: ModalBuilder,
  opts: { collector?: { resetTimer(): void }; timeMs?: number },
): Promise<ModalMessageModalSubmitInteraction<"cached"> | null> {
  const customId = modal.data.custom_id;
  if (!customId || parseSettingsId(customId)?.kind !== "modal") {
    throw new Error(
      "Settings modal custom ID must come from settingsIds.modal",
      {
        cause: { customId },
      },
    );
  }

  await interaction.showModal(modal);
  opts.collector?.resetTimer();

  let submission;
  try {
    submission = await interaction.awaitModalSubmit({
      time: opts.timeMs ?? DEFAULT_MODAL_TIME_MS,
      filter: (i) =>
        i.customId === customId && i.user.id === interaction.user.id,
    });
  } catch (err) {
    if (isCollectorTimeout(err)) {
      return null;
    }
    throw err;
  }

  opts.collector?.resetTimer();

  if (!submission.isFromMessage()) {
    throw new Error("Settings modal submission is not from a message", {
      cause: { customId, interactionId: submission.id },
    });
  }

  return submission;
}
