import { ModalBuilder } from "discord.js";

import type { ReasonFormData } from "@/features/moderation/reason-templates/application/ReasonTemplateService";
import {
  type ReasonFieldEmojis,
  buildCurrentReasonDisplay,
  buildEditOptions,
  buildReasonTextInput,
  buildSaveTemplateCheckbox,
  buildTemplateSelect,
} from "@/features/moderation/shared/presentation/reasonFields";
import { truncateText } from "@/utils/truncateText";

const TITLE_MAX_LENGTH = 45;

export interface ReasonEditModalOptions {
  customId: string;
  /** Use buildReasonEditTitle or your own; cut to 45 characters. */
  title: string;
  /**
   * The current reason, shown read-only. null means there's no reason yet:
   * the form becomes Set reason and the current reason display is left out.
   */
  currentReason: string | null;
  formData: ReasonFormData;
  emojis: ReasonFieldEmojis;
  lastExecutorName?: string | null;
  /**
   * Who the live DM went to ("spambot", "2 users"). Set: an Options group with
   * Save as template and "Also update the DM sent to …". null: just the Save
   * as template checkbox.
   */
  dmTo: string | null;
}

/** "Reason for #4822 · spambot", or "Reason for 2 cases". */
export function buildReasonEditTitle(
  caseIds: readonly string[],
  targetName: string | null,
): string {
  if (caseIds.length !== 1) {
    return `Reason for ${caseIds.length} cases`;
  }

  const head = `Reason for #${caseIds[0]}`;
  if (!targetName?.trim()) {
    return truncateText(head, TITLE_MAX_LENGTH);
  }

  const room = TITLE_MAX_LENGTH - head.length - 3;
  return room >= 4
    ? `${head} · ${truncateText(targetName.trim(), room)}`
    : truncateText(head, TITLE_MAX_LENGTH);
}

/**
 * Set or edit the reason of one or more cases. Parse the submit with
 * parseReasonFields; it returns the save and update-DM choices too.
 */
export function buildReasonEditModal(
  options: ReasonEditModalOptions,
): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(options.customId)
    .setTitle(truncateText(options.title, TITLE_MAX_LENGTH));

  if (options.currentReason) {
    modal.addTextDisplayComponents(
      buildCurrentReasonDisplay(options.currentReason),
    );
  }

  const templateSelect = buildTemplateSelect(
    options.formData,
    options.emojis,
    options.lastExecutorName ?? null,
  );
  if (templateSelect) {
    modal.addLabelComponents(templateSelect);
  }

  let textInput;
  if (options.currentReason) {
    textInput = buildReasonTextInput({
      label: "New reason or extra details",
      description:
        "Replaces the current reason. If you picked a template, this is added after it.",
      required: !templateSelect,
    });
  } else if (templateSelect) {
    textInput = buildReasonTextInput({
      description:
        "Added after the template if you picked one. Start with !shortcut to use a template.",
    });
  } else {
    textInput = buildReasonTextInput({
      label: "Reason",
      description: "Reason templates you create show up here as a list.",
      required: true,
    });
  }

  return modal.addLabelComponents(
    textInput,
    options.dmTo
      ? buildEditOptions({ dmTo: options.dmTo })
      : buildSaveTemplateCheckbox(),
  );
}
