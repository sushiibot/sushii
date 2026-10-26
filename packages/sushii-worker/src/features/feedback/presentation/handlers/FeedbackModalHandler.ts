import type { ModalSubmitFields, ModalSubmitInteraction } from "discord.js";
import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from "discord.js";

import ModalHandler from "@/shared/presentation/handlers/ModalHandler";
import Color from "@/utils/colors";

import type { FeedbackService } from "../../application/FeedbackService";
import type { FeedbackKind } from "../../domain/Feedback";
import {
  FEEDBACK_CONTENT_MAX_LENGTH,
  FEEDBACK_CONTENT_MIN_LENGTH,
  isFeedbackKind,
} from "../../domain/Feedback";
import type { FeedbackModalId } from "../customIds";
import { parseModalId } from "../customIds";
import {
  FEEDBACK_CONTENT_INPUT_ID,
  FEEDBACK_KIND_INPUT_ID,
} from "../views/FeedbackModal";

const BLANK_CHARS = /[\u00AD\u200B-\u200D\u2060\u2800\u3164\uFEFF]/g;

/**
 * Measured on the text with blank-rendering characters removed, so padding can't pass the
 * minimum; the stored text keeps them because emoji sequences rely on ZWJ.
 */
function lengthProblem(content: string): string | null {
  const length = [...content.replace(BLANK_CHARS, "").trim()].length;
  if (length < FEEDBACK_CONTENT_MIN_LENGTH) {
    return `Feedback needs at least ${FEEDBACK_CONTENT_MIN_LENGTH} characters.`;
  }
  if (length > FEEDBACK_CONTENT_MAX_LENGTH) {
    return `Feedback can be at most ${FEEDBACK_CONTENT_MAX_LENGTH} characters.`;
  }
  return null;
}

type FeedbackModalFields = Pick<
  ModalSubmitFields,
  "getTextInputValue" | "getStringSelectValues"
>;

export function readFeedbackKind(
  id: FeedbackModalId,
  fields: FeedbackModalFields,
): FeedbackKind {
  if (id.source === "error_report") {
    return "broken";
  }

  const [kind] = fields.getStringSelectValues(FEEDBACK_KIND_INPUT_ID);
  if (!kind || !isFeedbackKind(kind)) {
    throw new Error("Invalid feedback kind", { cause: kind });
  }

  return kind;
}

function reply(color: Color, content: string) {
  return {
    components: [
      new ContainerBuilder()
        .setAccentColor(color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
        .toJSON(),
    ],
    flags: MessageFlags.IsComponentsV2 as const,
    allowedMentions: { parse: [] },
  };
}

export class FeedbackModalHandler extends ModalHandler {
  customIDMatch = (customId: string) =>
    parseModalId(customId) !== null
      ? { path: customId, index: 0, params: {} }
      : false;

  constructor(private readonly feedbackService: FeedbackService) {
    super();
  }

  async handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    const id = parseModalId(interaction.customId);
    if (!id) {
      return;
    }

    const kind = readFeedbackKind(id, interaction.fields);
    const content = interaction.fields
      .getTextInputValue(FEEDBACK_CONTENT_INPUT_ID)
      .trim();

    const problem = lengthProblem(content);
    if (problem) {
      await interaction.reply({
        ...reply(Color.Warning, problem),
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
      return;
    }

    // The webhook post can wait out a rate limit, so don't race the 3s reply window.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const result = await this.feedbackService.submit({
      source: id.source,
      kind,
      feature: id.source === "panel" ? id.feature : null,
      traceId: id.source === "error_report" ? id.traceId : null,
      userId: interaction.user.id,
      guildId: interaction.guildId ?? null,
      content,
      reporter: {
        username: interaction.user.username,
        guildName: interaction.guild?.name ?? null,
      },
    });

    if (result.err) {
      await interaction.editReply(
        reply(
          Color.Warning,
          "⏳ **Slow down a little.** You've sent a lot of feedback recently, so try again later.",
        ),
      );
      return;
    }

    await interaction.editReply(
      reply(
        Color.Success,
        "✅ **Thanks!** Your feedback was sent to the sushii team.",
      ),
    );
  }
}
