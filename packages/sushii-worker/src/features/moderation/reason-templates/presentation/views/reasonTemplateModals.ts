import type { ModalSubmitFields } from "discord.js";
import {
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

import { REASON_MAX_LENGTH } from "@/features/moderation/shared/domain/value-objects/Reason";
import { truncateText } from "@/utils/truncateText";

import type { ReasonTemplateInput } from "../../application/ReasonTemplateService";
import { SHORTCUT_MAX_LENGTH } from "../../domain/ReasonExpander";
import type { ReasonTemplate } from "../../domain/ReasonTemplate";

export const TEMPLATE_FIELD_IDS = {
  shortcut: "shortcut",
  content: "content",
} as const;

function shortcutField(
  description: string,
  placeholder: string,
  prefill: string | null,
): LabelBuilder {
  const input = new TextInputBuilder()
    .setCustomId(TEMPLATE_FIELD_IDS.shortcut)
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(SHORTCUT_MAX_LENGTH)
    .setPlaceholder(placeholder);

  if (prefill) {
    input.setValue(prefill);
  }

  return new LabelBuilder()
    .setLabel("Shortcut")
    .setDescription(description)
    .setTextInputComponent(input);
}

function contentField(
  label: string,
  description: string,
  prefill: string | null,
): LabelBuilder {
  const input = new TextInputBuilder()
    .setCustomId(TEMPLATE_FIELD_IDS.content)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(REASON_MAX_LENGTH);

  const value = prefill ? truncateText(prefill, REASON_MAX_LENGTH) : null;
  if (value?.trim()) {
    input.setValue(value);
  }

  return new LabelBuilder()
    .setLabel(label)
    .setDescription(description)
    .setTextInputComponent(input);
}

/** Add form when template is null, otherwise the Edit form prefilled with it. */
export function buildTemplateFormModal(
  customId: string,
  template: ReasonTemplate | null,
): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(template ? "Edit template" : "Add template")
    .addLabelComponents(
      shortcutField(
        "Optional. Type it with ! at the start of a reason, like !spam.",
        "e.g. spam",
        template?.shortcut ?? null,
      ),
      contentField(
        "Reason",
        "Saved in full on each case. Editing this later doesn't change past cases.",
        template?.content ?? null,
      ),
    );
}

export function buildSaveTemplateModal(
  customId: string,
  prefillContent: string,
): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle("Save as template")
    .addLabelComponents(
      contentField(
        "Template text",
        "Edit it before saving if you want. The case keeps its own reason.",
        prefillContent,
      ),
      shortcutField(
        "Optional. Type !modmail at the start of a reason to use it.",
        "e.g. modmail",
        null,
      ),
    );
}

export function readTemplateFields(
  fields: Pick<ModalSubmitFields, "getTextInputValue">,
): ReasonTemplateInput {
  const shortcut = fields.getTextInputValue(TEMPLATE_FIELD_IDS.shortcut).trim();

  return {
    content: fields.getTextInputValue(TEMPLATE_FIELD_IDS.content),
    shortcut: shortcut || null,
  };
}
