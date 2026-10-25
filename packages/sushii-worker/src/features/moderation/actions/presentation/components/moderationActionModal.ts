import type { ModalSubmitFields } from "discord.js";
import {
  ActionRowBuilder,
  ContainerBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import { Duration } from "@/features/moderation/shared/domain/value-objects/Duration";
import {
  REASON_MAX_LENGTH,
  Reason,
} from "@/features/moderation/shared/domain/value-objects/Reason";
import Color from "@/utils/colors";

export type ModerationModalAction =
  | "warn"
  | "kick"
  | "ban"
  | "softban"
  | "unban"
  | "timeout"
  | "untimeout";

export type ModerationModalFields = Pick<
  ModalSubmitFields,
  "getTextInputValue" | "getStringSelectValues"
>;

export const REASON_CUSTOM_ID = "reason";
export const DELETE_SECONDS_CUSTOM_ID = "delete_seconds";
export const DURATION_CUSTOM_ID = "duration";

const MODAL_TITLES: Record<ModerationModalAction, string> = {
  warn: "Warn User",
  kick: "Kick User",
  ban: "Ban User",
  softban: "Softban User",
  unban: "Unban User",
  timeout: "Timeout User",
  untimeout: "Remove Timeout",
};

const BAN_DELETE_OPTIONS = [
  { label: "Previous hour", value: "3600", default: true },
  { label: "Don't delete any", value: "0" },
  { label: "Previous 12 hours", value: "43200" },
  { label: "Previous 24 hours", value: "86400" },
  { label: "Previous 3 days", value: "259200" },
  { label: "Previous 7 days", value: "604800" },
];

const SOFTBAN_DELETE_OPTIONS = [
  { label: "Previous hour", value: "3600", default: true },
  { label: "Previous 12 hours", value: "43200" },
  { label: "Previous 24 hours", value: "86400" },
  { label: "Previous 3 days", value: "259200" },
  { label: "Previous 7 days", value: "604800" },
];

const TIMEOUT_DURATION_OPTIONS = [
  { label: "10 minutes", value: "10m" },
  { label: "1 hour", value: "1h", default: true },
  { label: "1 day", value: "1d" },
  { label: "1 week", value: "7d" },
];

export function buildModerationErrorReply(message: string): {
  components: ReturnType<ContainerBuilder["toJSON"]>[];
  flags: number;
  ephemeral: boolean;
} {
  const container = new ContainerBuilder()
    .setAccentColor(Color.Error)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(message));
  return {
    components: [container.toJSON()],
    flags: MessageFlags.IsComponentsV2,
    ephemeral: true,
  };
}

function buildReasonRow(): ActionRowBuilder<TextInputBuilder> {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId(REASON_CUSTOM_ID)
      .setLabel("Reason")
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(REASON_MAX_LENGTH)
      .setRequired(false),
  );
}

export function buildModerationActionModal(
  actionType: ModerationModalAction,
  customId: string,
): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle(MODAL_TITLES[actionType]);

  if (actionType === "timeout") {
    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel("Duration")
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId(DURATION_CUSTOM_ID)
            .setRequired(true)
            .addOptions(TIMEOUT_DURATION_OPTIONS),
        ),
    );
  }

  modal.addComponents(buildReasonRow());

  if (actionType === "ban" || actionType === "softban") {
    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel("Delete message history")
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId(DELETE_SECONDS_CUSTOM_ID)
            .setPlaceholder("Previous hour")
            .addOptions(
              actionType === "ban"
                ? BAN_DELETE_OPTIONS
                : SOFTBAN_DELETE_OPTIONS,
            ),
        ),
    );
  }

  return modal;
}

/** Err holds a user-facing message. */
export function parseModalReason(
  fields: ModerationModalFields,
): Result<Reason | null, string> {
  const reasonText = fields.getTextInputValue(REASON_CUSTOM_ID).trim();
  if (!reasonText) {
    return Ok(null);
  }

  const reasonResult = Reason.create(reasonText);
  if (reasonResult.err) {
    return Err(`Invalid reason: ${reasonResult.val}`);
  }

  return reasonResult;
}

/** 0 when the select wasn't submitted. */
export function parseModalDeleteSeconds(fields: ModerationModalFields): number {
  let values: readonly string[];
  try {
    values = fields.getStringSelectValues(DELETE_SECONDS_CUSTOM_ID);
  } catch {
    // Select left untouched is omitted from the submit.
    return 0;
  }

  const seconds = parseInt(values[0] ?? "", 10);
  return isNaN(seconds) ? 0 : seconds;
}

/** Err holds a user-facing message. */
export function parseModalDuration(
  fields: ModerationModalFields,
): Result<Duration, string> {
  const value = fields.getStringSelectValues(DURATION_CUSTOM_ID)[0];
  if (!value || !TIMEOUT_DURATION_OPTIONS.some((o) => o.value === value)) {
    return Err("Pick a timeout duration.");
  }

  const durationResult = Duration.create(value);
  if (durationResult.err || !durationResult.val) {
    return Err("Pick a timeout duration.");
  }

  return Ok(durationResult.val);
}
