import {
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

import {
  FEATURE_LABELS,
  FEEDBACK_CONTENT_MAX_LENGTH,
  FEEDBACK_CONTENT_MIN_LENGTH,
  FEEDBACK_KINDS,
  FEEDBACK_KIND_OPTIONS,
} from "../../domain/Feedback";
import type { FeedbackTarget } from "../customIds";
import { buildModalId } from "../customIds";

export const FEEDBACK_CONTENT_INPUT_ID = "content";
export const FEEDBACK_KIND_INPUT_ID = "kind";

function contentInput(placeholder: string): TextInputBuilder {
  return new TextInputBuilder()
    .setCustomId(FEEDBACK_CONTENT_INPUT_ID)
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder(placeholder)
    .setRequired(true)
    .setMinLength(FEEDBACK_CONTENT_MIN_LENGTH)
    .setMaxLength(FEEDBACK_CONTENT_MAX_LENGTH);
}

function buildErrorModal(traceId: string | null): ModalBuilder {
  const intro = traceId
    ? "This goes straight to the sushii team. The error ID is attached automatically."
    : "This goes straight to the sushii team.";

  return new ModalBuilder()
    .setCustomId(buildModalId({ source: "error_report", traceId }))
    .setTitle("Send feedback to sushii")
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(intro))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("What were you trying to do?")
        .setDescription("What you expected and what happened instead.")
        .setTextInputComponent(contentInput("I was running a command and…")),
    );
}

function buildPanelModal(
  id: Extract<FeedbackTarget, { source: "panel" }>,
): ModalBuilder {
  const kindSelect = new StringSelectMenuBuilder()
    .setCustomId(FEEDBACK_KIND_INPUT_ID)
    .setPlaceholder("Pick one")
    .setRequired(true)
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      FEEDBACK_KINDS.map((kind) => ({
        value: kind,
        label: FEEDBACK_KIND_OPTIONS[kind].label,
        emoji: FEEDBACK_KIND_OPTIONS[kind].emoji,
      })),
    );

  return new ModalBuilder()
    .setCustomId(buildModalId(id))
    .setTitle("Send feedback")
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `About: **${FEATURE_LABELS[id.feature]}**\nIdeas, confusing bits, things that don't work, or things you like. It all goes straight to the sushii team.`,
      ),
    )
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("What kind of feedback?")
        .setStringSelectMenuComponent(kindSelect),
      new LabelBuilder()
        .setLabel("Tell us more")
        .setTextInputComponent(contentInput("It would help if…")),
    );
}

export function buildFeedbackModal(id: FeedbackTarget): ModalBuilder {
  if (id.source === "error_report") {
    return buildErrorModal(id.traceId);
  }

  return buildPanelModal(id);
}
