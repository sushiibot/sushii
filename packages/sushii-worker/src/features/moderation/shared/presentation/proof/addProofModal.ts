import type { Attachment, ModalSubmitFields } from "discord.js";
import {
  CheckboxGroupBuilder,
  CheckboxGroupOptionBuilder,
  FileUploadBuilder,
  LabelBuilder,
  ModalBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  escapeMarkdown,
} from "discord.js";

import type { ProofFileSource } from "../../application/proofDownloads";
import {
  PROOF_CONTENT_MAX_LENGTH,
  PROOF_FILES_PER_CASE_MAX,
} from "../../domain/entities/CaseProof";

export const ADD_PROOF_TEXT_ID = "text";
export const ADD_PROOF_FILES_ID = "files";
export const ADD_PROOF_FORM_PREFIX = "caseProof/form/";

export const ADD_PROOF_EMPTY_HINT = "Fill in Details, add a file, or both.";

export const ADD_PROOF_SUGGESTED_ID = "suggested";
/** Discord's limit for a Checkbox Group. */
export const SUGGESTED_OPTIONS_MAX = 10;
const OPTION_TEXT_MAX_LENGTH = 100;

export interface SuggestedProofOption {
  value: string;
  label: string;
  description: string | null;
  checked: boolean;
}

export interface AddProofModalInput {
  /** Unique per click so a dismissed form's collector can't take a later submit. */
  customId: string;
  caseIds: string[];
  /** Username of a single case's user; null for several cases. */
  userName: string | null;
  /** The most proof files any of the cases already has. */
  existingFiles: number;
  /** Suggested proof the mod can tick; only for a single case. */
  suggested?: readonly SuggestedProofOption[];
}

function clip(text: string): string {
  const chars = Array.from(text);
  return chars.length <= OPTION_TEXT_MAX_LENGTH
    ? text
    : `${chars.slice(0, OPTION_TEXT_MAX_LENGTH - 1).join("")}…`;
}

function suggestedLabel(
  userName: string | null,
  options: readonly SuggestedProofOption[],
): LabelBuilder {
  const who = userName ?? "this user";
  const shown = options.slice(0, SUGGESTED_OPTIONS_MAX);
  return new LabelBuilder()
    .setLabel("Suggested")
    .setDescription(clip(`From ${who}'s messages, in channels you can read`))
    .setCheckboxGroupComponent(
      new CheckboxGroupBuilder()
        .setCustomId(ADD_PROOF_SUGGESTED_ID)
        .setRequired(false)
        .setMinValues(0)
        .setMaxValues(shown.length)
        .addOptions(
          shown.map((option) => {
            const builder = new CheckboxGroupOptionBuilder()
              .setValue(option.value)
              .setLabel(clip(option.label))
              .setDefault(option.checked);
            if (option.description) {
              builder.setDescription(clip(option.description));
            }
            return builder;
          }),
        ),
    );
}

/** How many more files fit on every one of the cases. */
export function remainingFileSlots(existingFiles: number): number {
  return Math.max(0, PROOF_FILES_PER_CASE_MAX - existingFiles);
}

function title(caseIds: readonly string[]): string {
  return caseIds.length === 1
    ? `Add proof · Case #${caseIds[0]}`
    : `Add proof · ${caseIds.length} cases`;
}

function intro(input: AddProofModalInput, slots: number): string {
  const who = input.userName ? escapeMarkdown(input.userName) : "these users";
  const suggestions = input.suggested?.length
    ? " Suggestions save as links."
    : "";
  const lines = [
    `-# Only mods see proof. It's never sent to ${who}. Put anything they should see in the reason.${suggestions}`,
  ];
  if (slots === 0) {
    lines.push(
      input.caseIds.length === 1
        ? `-# This case already has ${PROOF_FILES_PER_CASE_MAX} files, the most it can hold. You can still add details.`
        : `-# One of these cases already has ${PROOF_FILES_PER_CASE_MAX} files, the most a case can hold. You can still add details.`,
    );
  }
  return lines.join("\n");
}

export function buildAddProofModal(input: AddProofModalInput): ModalBuilder {
  const slots = remainingFileSlots(input.existingFiles);
  const modal = new ModalBuilder()
    .setCustomId(input.customId)
    .setTitle(title(input.caseIds))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(intro(input, slots)),
    );

  if (input.suggested?.length) {
    modal.addLabelComponents(suggestedLabel(input.userName, input.suggested));
  }

  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel("Details")
      .setDescription("Context, message links, anything other mods should know")
      .setTextInputComponent(
        new TextInputBuilder()
          .setCustomId(ADD_PROOF_TEXT_ID)
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder(
            "e.g. Reported in #reports, also DM'd 3 other members",
          )
          .setRequired(false)
          .setMaxLength(PROOF_CONTENT_MAX_LENGTH),
      ),
  );

  if (slots > 0) {
    const where = input.caseIds.length === 1 ? "this case" : "each case";
    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel("Files")
        .setDescription(
          `Screenshots or recordings · up to ${slots} more on ${where}`,
        )
        .setFileUploadComponent(
          new FileUploadBuilder()
            .setCustomId(ADD_PROOF_FILES_ID)
            .setRequired(false)
            .setMinValues(0)
            .setMaxValues(slots),
        ),
    );
  }

  return modal;
}

export interface AddProofFields {
  content: string | null;
  files: ProofFileSource[];
  /** Checked suggestion values; empty when none were offered. */
  suggested: string[];
}

function proofFile(attachment: Attachment): ProofFileSource {
  return {
    url: attachment.url,
    name: attachment.name,
    size: attachment.size,
    contentType: attachment.contentType,
  };
}

/** Optional fields may be left out of the submission, and the file field isn't always shown. */
export function readAddProofFields(fields: ModalSubmitFields): AddProofFields {
  const content = fields.fields.has(ADD_PROOF_TEXT_ID)
    ? fields.getTextInputValue(ADD_PROOF_TEXT_ID).trim() || null
    : null;
  const uploads = fields.fields.has(ADD_PROOF_FILES_ID)
    ? fields.getUploadedFiles(ADD_PROOF_FILES_ID)
    : null;
  const suggested = fields.fields.has(ADD_PROOF_SUGGESTED_ID)
    ? [...fields.getCheckboxGroup(ADD_PROOF_SUGGESTED_ID)]
    : [];
  return {
    content,
    files: uploads ? [...uploads.values()].map(proofFile) : [],
    suggested,
  };
}
