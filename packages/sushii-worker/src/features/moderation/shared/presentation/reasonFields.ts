import type { ModalSubmitFields } from "discord.js";
import {
  CheckboxBuilder,
  CheckboxGroupBuilder,
  LabelBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type { BotEmojiNameType, EmojiMap } from "@/features/bot-emojis/domain";
import type { ReasonFormData } from "@/features/moderation/reason-templates/application/ReasonTemplateService";
import type { ReasonTemplateService } from "@/features/moderation/reason-templates/application/ReasonTemplateService";
import type {
  ExpandResult,
  TemplateRef,
} from "@/features/moderation/reason-templates/domain/ReasonExpander";
import {
  LABEL_MAX_LENGTH,
  joinReason,
  previewText,
  toTemplateRef,
} from "@/features/moderation/reason-templates/domain/ReasonExpander";
import { truncateText } from "@/utils/truncateText";

import type { ReasonTracking } from "../domain/metrics/ModerationMetrics";
import { reasonSource } from "../domain/metrics/ModerationMetrics";
import { REASON_MAX_LENGTH } from "../domain/value-objects/Reason";

export const UNRESOLVED_TEMPLATE_MESSAGE =
  "That looks like an old or edited template pick. Pick the template again, or type the reason without the label.";

export const REASON_FIELD_IDS = {
  template: "reason_template",
  text: "reason",
  save: "save_as_template",
  options: "reason_options",
} as const;

export const REASON_SELECT_VALUES = {
  last: "last",
  templatePrefix: "template:",
} as const;

export const REASON_OPTION_VALUES = {
  save: "save",
  updateDm: "update_dm",
} as const;

export const REASON_FIELD_EMOJIS = [
  "history",
] as const satisfies readonly BotEmojiNameType[];

export type ReasonFieldEmojis = EmojiMap<typeof REASON_FIELD_EMOJIS>;

export type ReasonFieldValues = Pick<
  ModalSubmitFields,
  | "fields"
  | "getTextInputValue"
  | "getStringSelectValues"
  | "getCheckbox"
  | "getCheckboxGroup"
>;

export interface ParsedReasonFields {
  text: string | null;
  template: TemplateRef | null;
  unknownShortcut: string | null;
  /** Typed text referred to a template or recent reason that no longer resolves. */
  unresolved: ExpandResult["unresolved"];
  saveAsTemplate: boolean;
  updateDm: boolean;
}

export interface ReasonFieldsTooLong {
  code: "too_long";
  length: number;
  max: number;
}

/** Discord limit for select option descriptions and label descriptions. */
const DESCRIPTION_MAX_LENGTH = 100;
const DESCRIPTION_SEPARATOR = " · ";
/** Discord limit for a text display's content. */
export const TEXT_DISPLAY_MAX_LENGTH = 4000;

/** Plain text, since select descriptions can't render `<t:R>` timestamps. */
export function formatRelativeTime(from: Date, now: Date): string {
  if (!Number.isFinite(from.getTime())) {
    return "some time ago";
  }

  const seconds = Math.max(
    0,
    Math.floor((now.getTime() - from.getTime()) / 1000),
  );
  if (seconds < 60) {
    return "just now";
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hr ago`;
  }

  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

function lastReasonDescription(
  last: NonNullable<ReasonFormData["last"]>,
  executorName: string | null,
  now: Date,
): string {
  const head = [
    executorName ? previewText(executorName, 32) : null,
    formatRelativeTime(last.actionTime, now),
  ]
    .filter(Boolean)
    .join(" · ");
  const preview = previewText(
    last.reason,
    DESCRIPTION_MAX_LENGTH - head.length - DESCRIPTION_SEPARATOR.length,
  );

  return preview ? head + DESCRIPTION_SEPARATOR + preview : head;
}

export function buildTemplateSelect(
  formData: ReasonFormData,
  emojis: ReasonFieldEmojis,
  lastExecutorName: string | null = null,
  now: Date = new Date(),
): LabelBuilder | null {
  const options: StringSelectMenuOptionBuilder[] = [];

  if (formData.last) {
    const sameAsLast = new StringSelectMenuOptionBuilder()
      .setLabel("Same as last reason")
      .setValue(REASON_SELECT_VALUES.last)
      .setDescription(
        lastReasonDescription(formData.last, lastExecutorName, now),
      );
    // A missing bot emoji comes back as "", which setEmoji rejects.
    if (emojis.history) {
      sameAsLast.setEmoji(emojis.history);
    }
    options.push(sameAsLast);
  }

  for (const template of formData.templates.slice(0, 25 - options.length)) {
    const preview = previewText(template.content, DESCRIPTION_MAX_LENGTH);
    const option = new StringSelectMenuOptionBuilder()
      .setLabel(
        template.shortcut
          ? `!${template.shortcut}`
          : previewText(template.content, LABEL_MAX_LENGTH) || "Template",
      )
      .setValue(`${REASON_SELECT_VALUES.templatePrefix}${template.id}`);

    if (preview) {
      option.setDescription(preview);
    }

    options.push(option);
  }

  if (options.length === 0) {
    return null;
  }

  return new LabelBuilder()
    .setLabel("Template")
    .setDescription("Text typed below is added after it.")
    .setStringSelectMenuComponent(
      new StringSelectMenuBuilder()
        .setCustomId(REASON_FIELD_IDS.template)
        .setPlaceholder("Pick a template")
        .setRequired(false)
        .setMinValues(0)
        .setMaxValues(1)
        .addOptions(options),
    );
}

export function buildReasonTextInput({
  label = "Reason or extra details",
  description,
  required = false,
}: {
  label?: string;
  description?: string;
  required?: boolean;
} = {}): LabelBuilder {
  const builder = new LabelBuilder()
    .setLabel(label)
    .setTextInputComponent(
      new TextInputBuilder()
        .setCustomId(REASON_FIELD_IDS.text)
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("Type !shortcut to use a template")
        .setMaxLength(REASON_MAX_LENGTH)
        .setRequired(required),
    );

  if (description) {
    builder.setDescription(description);
  }

  return builder;
}

export function buildSaveTemplateCheckbox(): LabelBuilder {
  return new LabelBuilder()
    .setLabel("Save as template")
    .setDescription("Reuse this reason later from the Template list.")
    .setCheckboxComponent(
      new CheckboxBuilder()
        .setCustomId(REASON_FIELD_IDS.save)
        .setDefault(false),
    );
}

export function buildEditOptions({
  dmTo,
}: {
  dmTo: string | null;
}): LabelBuilder {
  const options: { label: string; value: string }[] = [
    {
      label: "Save as template",
      value: REASON_OPTION_VALUES.save,
    },
  ];

  if (dmTo) {
    options.push({
      label: previewText(
        `Also update the DM sent to ${dmTo}`,
        LABEL_MAX_LENGTH,
      ),
      value: REASON_OPTION_VALUES.updateDm,
    });
  }

  return new LabelBuilder()
    .setLabel("Options")
    .setCheckboxGroupComponent(
      new CheckboxGroupBuilder()
        .setCustomId(REASON_FIELD_IDS.options)
        .setRequired(false)
        .setMinValues(0)
        .setMaxValues(options.length)
        .setOptions(options),
    );
}

/** Block-quotes every line, cut to maxLength after quoting. */
export function quoteLines(text: string, maxLength: number): string {
  return truncateText(
    text
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n"),
    maxLength,
  );
}

export function buildCurrentReasonDisplay(
  reason: string | null,
): TextDisplayBuilder {
  const heading = "**Current reason**\n";
  const body = reason
    ? quoteLines(reason, TEXT_DISPLAY_MAX_LENGTH - heading.length)
    : "-# No reason set";

  return new TextDisplayBuilder().setContent(heading + body);
}

function selectedTemplate(
  pick: string | undefined,
  formData: ReasonFormData,
): {
  text: string;
  template: TemplateRef | null;
  kind: "template" | "recent";
} | null {
  if (!pick) {
    return null;
  }

  if (pick === REASON_SELECT_VALUES.last) {
    return formData.last
      ? { text: formData.last.reason, template: null, kind: "recent" }
      : null;
  }

  if (pick.startsWith(REASON_SELECT_VALUES.templatePrefix)) {
    const id = pick.slice(REASON_SELECT_VALUES.templatePrefix.length);
    const template = formData.templates.find((t) => t.id === id);

    return template
      ? {
          text: template.content,
          template: toTemplateRef(template),
          kind: "template",
        }
      : null;
  }

  return null;
}

/**
 * Combines the dropdown pick with the expanded typed text. Every field is
 * optional, so forms can include any subset of the reason fields.
 */
export async function parseReasonFields(
  fields: ReasonFieldValues,
  formData: ReasonFormData,
  service: Pick<ReasonTemplateService, "resolve">,
  guildId: string,
  tracking?: ReasonTracking,
): Promise<Result<ParsedReasonFields, ReasonFieldsTooLong>> {
  const has = (id: string): boolean => fields.fields.has(id);

  const picked = has(REASON_FIELD_IDS.template)
    ? selectedTemplate(
        fields.getStringSelectValues(REASON_FIELD_IDS.template)[0],
        formData,
      )
    : null;

  const typed = has(REASON_FIELD_IDS.text)
    ? fields.getTextInputValue(REASON_FIELD_IDS.text).trim()
    : "";
  const expanded = typed ? await service.resolve(guildId, typed) : null;

  const text = joinReason(picked?.text ?? "", expanded?.text ?? "");
  const tooLong = text.length > REASON_MAX_LENGTH && !expanded?.unresolved;

  if (tracking) {
    const source = reasonSource({
      surface: tracking.surface,
      expanded,
      picked: picked?.kind ?? null,
      tooLong,
      hasText: !!text,
    });
    if (source) {
      tracking.metrics.recordReasonResolved(tracking.surface, source);
    }
  }

  if (tooLong) {
    return Err({
      code: "too_long",
      length: text.length,
      max: REASON_MAX_LENGTH,
    });
  }

  const options = has(REASON_FIELD_IDS.options)
    ? fields.getCheckboxGroup(REASON_FIELD_IDS.options)
    : [];
  const saveChecked = has(REASON_FIELD_IDS.save)
    ? fields.getCheckbox(REASON_FIELD_IDS.save)
    : false;

  return Ok({
    text: text || null,
    template: picked?.template ?? expanded?.template ?? null,
    unknownShortcut: expanded?.unknownShortcut ?? null,
    unresolved: expanded?.unresolved ?? null,
    saveAsTemplate: saveChecked || options.includes(REASON_OPTION_VALUES.save),
    updateDm: options.includes(REASON_OPTION_VALUES.updateDm),
  });
}
