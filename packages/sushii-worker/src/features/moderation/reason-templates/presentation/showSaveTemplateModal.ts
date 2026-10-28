import type {
  InteractionUpdateOptions,
  ModalSubmitInteraction,
} from "discord.js";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain";

import type {
  ReasonTemplateError,
  ReasonTemplateService,
} from "../application/ReasonTemplateService";
import type { ReasonTemplate } from "../domain/ReasonTemplate";
import { buildModalId } from "./customIds";
import type { ModalOpener } from "./templateModal";
import {
  REASON_TEMPLATES_EMOJIS,
  requireModOnSubmit,
  showAndAwaitModal,
} from "./templateModal";
import { buildTemplateSavedMessage } from "./templateSavedMessage";
import { buildReasonTemplateErrorMessage } from "./views/reasonTemplateErrors";
import {
  buildSaveTemplateModal,
  readTemplateFields,
} from "./views/reasonTemplateModals";

export interface SaveTemplateDeps {
  reasonTemplateService: Pick<ReasonTemplateService, "create">;
  emojiRepository: Pick<BotEmojiRepository, "getEmojis">;
}

export interface SavedTemplate {
  template: ReasonTemplate;
  /** Already answered; the "Template saved" confirmation was sent privately. */
  submit: ModalSubmitInteraction<"cached">;
}

export interface SaveTemplateOptions {
  prefillContent: string;
  /**
   * Re-renders the message the button was on after a successful save, e.g.
   * without its Save as template button. The confirmation then goes out as a
   * private follow-up, since the submit can only be acknowledged once. The
   * submit carries the message as it is at submit time.
   */
  buildUpdate?: (
    template: ReasonTemplate,
    submit: ModalSubmitInteraction<"cached">,
  ) => Promise<InteractionUpdateOptions>;
}

export type SaveTemplateFailure =
  | { code: "dismissed" }
  | { code: "no_permission" }
  | ReasonTemplateError;

/**
 * Shows the "Save as template" form and creates the template on submit.
 *
 * - The caller checks the clicker's permission first, and this must be the
 *   interaction's first response, since `showModal` uses up its one ack.
 * - `dismissed`: the form timed out or was closed. The ack was spent on the
 *   form, so the caller must not reply.
 * - `no_permission` and every service error were already answered privately.
 * - Only `Ok` carries `submit`, already answered with the confirmation.
 * - If `buildUpdate` throws, the template is already saved.
 */
export async function showSaveTemplateModal(
  interaction: ModalOpener,
  { prefillContent, buildUpdate }: SaveTemplateOptions,
  deps: SaveTemplateDeps,
): Promise<Result<SavedTemplate, SaveTemplateFailure>> {
  const submit = await showAndAwaitModal(
    interaction,
    buildSaveTemplateModal(buildModalId("saveModal"), prefillContent),
  );
  if (!submit) {
    return Err({ code: "dismissed" });
  }

  const emojis = await deps.emojiRepository.getEmojis(REASON_TEMPLATES_EMOJIS);
  if (!(await requireModOnSubmit(submit, emojis))) {
    return Err({ code: "no_permission" });
  }

  const created = await deps.reasonTemplateService.create(submit.guildId, {
    ...readTemplateFields(submit.fields),
    createdBy: submit.user.id,
  });
  if (created.err) {
    await submit.reply(buildReasonTemplateErrorMessage(created.val, emojis));
    return created;
  }

  const confirmation = buildTemplateSavedMessage(created.val, emojis, {
    fromCheckbox: false,
  });
  if (buildUpdate && submit.isFromMessage()) {
    await submit.update(await buildUpdate(created.val, submit));
    await submit.followUp(confirmation);
  } else {
    await submit.reply(confirmation);
  }

  return Ok({ template: created.val, submit });
}
