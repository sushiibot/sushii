import type {
  APIModalInteractionResponseCallbackData,
  ButtonInteraction,
  InteractionReplyOptions,
  ModalSubmitFields,
  ModalSubmitInteraction,
} from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
} from "discord.js";
import { randomBytes } from "node:crypto";
import type { Logger } from "pino";

import type { BotEmojiNameType, EmojiMap } from "@/features/bot-emojis/domain";
import type { BotEmojiRepository } from "@/features/bot-emojis/domain/repositories/BotEmojiRepository";
import type { ReasonTemplateService } from "@/features/moderation/reason-templates/application/ReasonTemplateService";
import {
  TEMPLATE_SAVED_EMOJIS,
  buildTemplateSavedMessage,
} from "@/features/moderation/reason-templates/presentation/templateSavedMessage";
import type { ModerationMetrics } from "@/features/moderation/shared/domain/metrics/ModerationMetrics";
import {
  type ParsedReasonFields,
  REASON_FIELD_EMOJIS,
  type ReasonFieldsTooLong,
  parseReasonFields,
} from "@/features/moderation/shared/presentation/reasonFields";
import { UNRESOLVED_TEMPLATE_MESSAGE } from "@/features/moderation/shared/presentation/reasonFields";
import Color from "@/utils/colors";

import {
  type ModerationModalAction,
  buildModerationActionModal,
} from "./moderationActionModal";

export const REASON_FORM_EMOJIS = [
  ...REASON_FIELD_EMOJIS,
  ...TEMPLATE_SAVED_EMOJIS,
  "fail",
] as const satisfies readonly BotEmojiNameType[];

export type ReasonFormEmojis = EmojiMap<typeof REASON_FORM_EMOJIS>;

export { UNRESOLVED_TEMPLATE_MESSAGE };

const number = new Intl.NumberFormat("en-US");

export function tooLongMessage(error: ReasonFieldsTooLong): string {
  return `**Nothing was done.** The reason is ${number.format(error.length)} characters after adding the template; the limit is ${number.format(error.max)}. Shorten the details by ${number.format(error.length - error.max)} characters.`;
}

/** Ephemeral components v2 error, optionally with a Try again button. */
export function buildReasonFormError(
  text: string,
  emojis: Pick<ReasonFormEmojis, "fail">,
  retryCustomId?: string,
): InteractionReplyOptions {
  const container = new ContainerBuilder()
    .setAccentColor(Color.Error)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        emojis.fail ? `${emojis.fail} ${text}` : text,
      ),
    );

  if (retryCustomId) {
    container.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(retryCustomId)
          .setLabel("Try again")
          .setStyle(ButtonStyle.Primary),
      ),
    );
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  };
}

function plainEphemeral(text: string): InteractionReplyOptions {
  return {
    content: text,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  };
}

interface FollowUpTarget {
  followUp(options: InteractionReplyOptions): Promise<unknown>;
}

export interface ReasonFormFollowUpDeps {
  reasonTemplateService: Pick<ReasonTemplateService, "recordUse" | "create">;
  emojiRepository: Pick<BotEmojiRepository, "getEmojis">;
  logger: Logger;
}

/**
 * Runs after the action or edit succeeded: records template use, saves the
 * reason as a template when ticked and notes an unknown shortcut. Save
 * problems never undo the action; they become a private note.
 */
export async function completeReasonForm(
  interaction: FollowUpTarget,
  deps: ReasonFormFollowUpDeps,
  context: {
    guildId: string;
    userId: string;
    parsed: ParsedReasonFields;
    emojis: ReasonFormEmojis;
  },
): Promise<void> {
  const { guildId, userId, parsed, emojis } = context;

  if (parsed.template) {
    await deps.reasonTemplateService.recordUse(guildId, parsed.template.id);
  }

  if (parsed.unknownShortcut) {
    await interaction.followUp(
      plainEphemeral(
        `No template \`!${parsed.unknownShortcut}\`, so the reason was saved as typed. Change it with Edit reason or \`/reason\`.`,
      ),
    );
  }

  if (!parsed.saveAsTemplate) {
    return;
  }

  if (!parsed.text) {
    await interaction.followUp(
      plainEphemeral("Not saved as a template: the reason was empty."),
    );
    return;
  }

  const created = await deps.reasonTemplateService.create(
    guildId,
    {
      content: parsed.text,
      shortcut: null,
      createdBy: userId,
    },
    "checkbox",
  );

  if (created.ok) {
    await interaction.followUp(
      buildTemplateSavedMessage(created.val, emojis, { fromCheckbox: true }),
    );
    return;
  }

  const error = created.val;
  let note: string;
  switch (error.code) {
    case "duplicate":
      note = error.existing?.shortcut
        ? `Not saved as a template: it's already the template \`!${error.existing.shortcut}\`.`
        : "Not saved as a template: this text is already a template.";
      break;
    case "limit_reached":
      note = `Not saved as a template: this server has ${error.limit} templates, the maximum. Delete one in \`/reason-templates\` to add more.`;
      break;
    default:
      note = "Not saved as a template: the reason can't be used as one.";
  }

  deps.logger.debug(
    { guildId, userId, code: error.code },
    "Reason form template save refused",
  );
  await interaction.followUp(plainEphemeral(note));
}

export type FieldValues = Record<string, string | boolean | readonly string[]>;

/** Everything a submit carried, so a Try again form can reopen prefilled. */
export function captureModalValues(
  fields: Pick<ModalSubmitFields, "fields">,
): FieldValues {
  const values: FieldValues = {};
  for (const [customId, field] of fields.fields) {
    if ("value" in field && field.value !== null) {
      values[customId] = field.value;
    } else if ("values" in field) {
      values[customId] = [...field.values];
    }
  }
  return values;
}

type ModalJSON = APIModalInteractionResponseCallbackData;

/** Fills a built form with earlier values; unknown fields are left alone. */
export function prefillModal(modal: ModalJSON, values: FieldValues): ModalJSON {
  for (const top of modal.components) {
    if (top.type !== ComponentType.Label) {
      continue;
    }

    const component = top.component;
    const value = values[component.custom_id ?? ""];
    if (value === undefined) {
      continue;
    }

    switch (component.type) {
      case ComponentType.TextInput:
        if (typeof value === "string" && value) {
          component.value = value;
        }
        break;
      case ComponentType.StringSelect:
      case ComponentType.CheckboxGroup:
        if (Array.isArray(value)) {
          for (const option of component.options) {
            option.default = value.includes(option.value);
          }
        }
        break;
      case ComponentType.Checkbox:
        if (typeof value === "boolean") {
          component.default = value;
        }
        break;
      default:
        break;
    }
  }

  return modal;
}

const RETRY_TTL_MS = 10 * 60 * 1000;
const RETRY_MAX_ENTRIES = 500;

/**
 * Keeps a refused form's input for its Try again button. In memory only, so
 * after a restart Try again just says the form expired.
 */
export class ReasonFormRetryStore<T> {
  private readonly entries = new Map<
    string,
    { userId: string; value: T; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(
    private readonly ttlMs = RETRY_TTL_MS,
    private readonly maxEntries = RETRY_MAX_ENTRIES,
  ) {}

  /** Only userId can claim the token later. */
  put(userId: string, value: T): string {
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.delete(oldest);
      }
    }

    const token = randomBytes(9).toString("base64url");
    const timer = setTimeout(() => this.entries.delete(token), this.ttlMs);
    timer.unref?.();
    this.entries.set(token, { userId, value, timer });

    return token;
  }

  claim(token: string, userId: string): T | "expired" | "wrong_user" {
    const entry = this.entries.get(token);
    if (!entry) {
      return "expired";
    }
    return entry.userId === userId ? entry.value : "wrong_user";
  }

  delete(token: string): void {
    const entry = this.entries.get(token);
    if (entry) {
      clearTimeout(entry.timer);
      this.entries.delete(token);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

export function buildRetryMatcher(prefix: string) {
  const pattern = new RegExp(`^${prefix}/([A-Za-z0-9_-]+)$`);

  return {
    build: (token: string): string => `${prefix}/${token}`,
    parse: (customId: string): string | null =>
      pattern.exec(customId)?.[1] ?? null,
  };
}

export const RETRY_EXPIRED_MESSAGE =
  "This form expired. Click the button on the original message again.";

export const RETRY_WRONG_USER_MESSAGE =
  "This Try again button belongs to someone else.";

export function retryRefusedReply(
  refusal: "expired" | "wrong_user",
): InteractionReplyOptions {
  return plainEphemeral(
    refusal === "expired" ? RETRY_EXPIRED_MESSAGE : RETRY_WRONG_USER_MESSAGE,
  );
}

export interface ActionReasonFormDeps {
  reasonTemplateService: Pick<
    ReasonTemplateService,
    "getFormData" | "resolve" | "recordUse" | "create"
  >;
  emojiRepository: Pick<BotEmojiRepository, "getEmojis">;
  metrics: Pick<ModerationMetrics, "recordReasonResolved">;
  logger: Logger;
}

export interface ActionReasonFormSubmit {
  submission: ModalSubmitInteraction<"cached">;
  parsed: ParsedReasonFields;
  emojis: ReasonFormEmojis;
}

const FORM_TIMEOUT_MS = 5 * 60 * 1000;

function cachedDisplayName(
  interaction: ButtonInteraction<"cached">,
  userId: string | null,
): string | null {
  if (!userId) {
    return null;
  }

  return (
    interaction.guild.members.cache.get(userId)?.displayName ??
    interaction.client.users.cache.get(userId)?.displayName ??
    null
  );
}

/**
 * Shows the shared action form, waits for the submit and parses its reason.
 * Replies to refused submits itself: too long (with Try again, via
 * storeRetry) and unresolved template picks. Returns null when nothing more
 * should happen.
 */
export async function runActionReasonForm(
  interaction: ButtonInteraction<"cached">,
  deps: ActionReasonFormDeps,
  options: {
    actionType: ModerationModalAction;
    targetId: string;
    prefill?: FieldValues;
    /** Keeps the submitted values and returns the Try again button's custom ID. */
    storeRetry: (values: FieldValues) => string;
  },
): Promise<ActionReasonFormSubmit | null> {
  // Small indexed reads: a modal has to be the first response, so no defer.
  const [formData, emojis] = await Promise.all([
    deps.reasonTemplateService.getFormData(interaction.guildId),
    deps.emojiRepository.getEmojis(REASON_FORM_EMOJIS),
  ]);

  // Unique per click so a collector from a dismissed form can't take a later submit.
  const modalCustomId = `reasonForm/${interaction.id}`;
  const modal = buildModerationActionModal({
    actionType: options.actionType,
    customId: modalCustomId,
    targetName: cachedDisplayName(interaction, options.targetId) ?? "user",
    formData,
    emojis,
    lastExecutorName: cachedDisplayName(
      interaction,
      formData.last?.executorId ?? null,
    ),
  }).toJSON();

  await interaction.showModal(
    options.prefill ? prefillModal(modal, options.prefill) : modal,
  );

  let submission: ModalSubmitInteraction;
  try {
    submission = await interaction.awaitModalSubmit({
      time: FORM_TIMEOUT_MS,
      filter: (i) =>
        i.user.id === interaction.user.id && i.customId === modalCustomId,
    });
  } catch {
    // Rejects only when the form times out or is dismissed.
    deps.logger.debug(
      { actionType: options.actionType, executorId: interaction.user.id },
      "Action reason form timed out",
    );
    return null;
  }

  if (!submission.inCachedGuild()) {
    throw new Error("Not a guild interaction");
  }

  const parsed = await parseReasonFields(
    submission.fields,
    formData,
    deps.reasonTemplateService,
    submission.guildId,
    { metrics: deps.metrics, surface: "form" },
  );
  if (parsed.err) {
    const retryCustomId = options.storeRetry(
      captureModalValues(submission.fields),
    );
    await submission.reply(
      buildReasonFormError(tooLongMessage(parsed.val), emojis, retryCustomId),
    );
    return null;
  }

  if (parsed.val.unresolved) {
    await submission.reply(
      buildReasonFormError(UNRESOLVED_TEMPLATE_MESSAGE, emojis),
    );
    return null;
  }

  return { submission, parsed: parsed.val, emojis };
}
