import type { ModalSubmitFields } from "discord.js";
import {
  ContainerBuilder,
  DiscordjsErrorCodes,
  DiscordjsTypeError,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} from "discord.js";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type { ReasonFormData } from "@/features/moderation/reason-templates/application/ReasonTemplateService";
import { Duration } from "@/features/moderation/shared/domain/value-objects/Duration";
import {
  type ReasonFieldEmojis,
  buildReasonTextInput,
  buildSaveTemplateCheckbox,
  buildTemplateSelect,
} from "@/features/moderation/shared/presentation/reasonFields";
import Color from "@/utils/colors";
import { truncateText } from "@/utils/truncateText";

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

export const DELETE_SECONDS_CUSTOM_ID = "delete_seconds";
export const DURATION_CUSTOM_ID = "duration";

const TITLE_MAX_LENGTH = 45;

const TITLE_VERBS: Record<ModerationModalAction, string> = {
  warn: "Warn",
  kick: "Kick",
  ban: "Ban",
  softban: "Softban",
  unban: "Unban",
  timeout: "Timeout",
  untimeout: "Remove timeout for",
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

const DEFAULT_TIMEOUT_DURATION = "1h";

const TIMEOUT_DURATION_OPTIONS = [
  { label: "10 minutes", value: "10m" },
  { label: "1 hour", value: DEFAULT_TIMEOUT_DURATION, default: true },
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

export interface ModerationActionModalOptions {
  actionType: ModerationModalAction;
  customId: string;
  /** The target's display name, cut to fit the title. */
  targetName: string;
  formData: ReasonFormData;
  emojis: ReasonFieldEmojis;
  /** Display name of whoever gave the last reason, for "Same as last reason". */
  lastExecutorName?: string | null;
}

export function buildModerationActionTitle(
  actionType: ModerationModalAction,
  targetName: string,
): string {
  const verb = TITLE_VERBS[actionType];
  const name = truncateText(
    targetName.trim() || "user",
    TITLE_MAX_LENGTH - verb.length - 1,
  );
  return `${verb} ${name}`;
}

function buildActionField(
  actionType: ModerationModalAction,
): LabelBuilder | null {
  if (actionType === "timeout") {
    return new LabelBuilder()
      .setLabel("Duration")
      .setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId(DURATION_CUSTOM_ID)
          .setRequired(true)
          .addOptions(TIMEOUT_DURATION_OPTIONS),
      );
  }

  if (actionType === "ban" || actionType === "softban") {
    return new LabelBuilder()
      .setLabel("Delete message history")
      .setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId(DELETE_SECONDS_CUSTOM_ID)
          .setPlaceholder("Previous hour")
          .addOptions(
            actionType === "ban" ? BAN_DELETE_OPTIONS : SOFTBAN_DELETE_OPTIONS,
          ),
      );
  }

  return null;
}

/** Action fields first, then Template, Reason and Save as template. */
export function buildModerationActionModal(
  options: ModerationActionModalOptions,
): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(options.customId)
    .setTitle(
      buildModerationActionTitle(options.actionType, options.targetName),
    );

  const actionField = buildActionField(options.actionType);
  if (actionField) {
    modal.addLabelComponents(actionField);
  }

  // A select needs at least one option, so it's left out when there's nothing to pick.
  const templateSelect = buildTemplateSelect(
    options.formData,
    options.emojis,
    options.lastExecutorName ?? null,
  );
  if (templateSelect) {
    modal.addLabelComponents(
      templateSelect,
      buildReasonTextInput({
        description:
          "Added after the template if you picked one. Start with !shortcut to use a template.",
      }),
    );
  } else {
    modal.addLabelComponents(
      buildReasonTextInput({
        label: "Reason",
        description: "Reason templates you create show up here as a list.",
      }),
    );
  }

  return modal.addLabelComponents(buildSaveTemplateCheckbox());
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

/** The pre-selected default may arrive with no values or no component at all. */
function selectedDuration(fields: ModerationModalFields): string {
  let values: readonly string[] | undefined;
  try {
    values = fields.getStringSelectValues(DURATION_CUSTOM_ID);
  } catch (err) {
    if (
      err instanceof DiscordjsTypeError &&
      err.code === DiscordjsErrorCodes.ModalSubmitInteractionFieldNotFound
    ) {
      return DEFAULT_TIMEOUT_DURATION;
    }
    throw err;
  }

  return values?.[0] ?? DEFAULT_TIMEOUT_DURATION;
}

/** Err holds a user-facing message. */
export function parseModalDuration(
  fields: ModerationModalFields,
): Result<Duration, string> {
  const value = selectedDuration(fields);
  if (!TIMEOUT_DURATION_OPTIONS.some((o) => o.value === value)) {
    return Err("Pick a timeout duration.");
  }

  const durationResult = Duration.create(value);
  if (durationResult.err || !durationResult.val) {
    return Err("Pick a timeout duration.");
  }

  return Ok(durationResult.val);
}
