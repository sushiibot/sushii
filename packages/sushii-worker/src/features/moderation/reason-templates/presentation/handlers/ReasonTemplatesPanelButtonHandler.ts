import type { ButtonInteraction } from "discord.js";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain";
import { ButtonHandler } from "@/shared/presentation/handlers";
import {
  ANY_MOD_PERMISSION,
  requireMemberPermission,
} from "@/shared/presentation/requireMemberPermission";

import type { ReasonTemplateService } from "../../application/ReasonTemplateService";
import { REASON_TEMPLATE_LIMIT } from "../../application/ReasonTemplateService";
import type { PanelAction } from "../customIds";
import { buildModalId, matchPanelCustomId, parsePanelId } from "../customIds";
import type { ReasonTemplatesEmojis } from "../templateModal";
import {
  REASON_TEMPLATES_EMOJIS,
  requireModOnSubmit,
  showAndAwaitModal,
} from "../templateModal";
import {
  MISSING_TEMPLATE_NOTICE,
  addedNotice,
  buildDeleteConfirmMessage,
  buildDetailMessage,
  buildListMessage,
  deletedNotice,
} from "../views/ReasonTemplatesPanelView";
import { buildReasonTemplateErrorMessage } from "../views/reasonTemplateErrors";
import {
  buildTemplateFormModal,
  readTemplateFields,
} from "../views/reasonTemplateModals";

type TemplateAction = Extract<PanelAction, { templateId: string }>;

export class ReasonTemplatesPanelButtonHandler extends ButtonHandler {
  customIDMatch = matchPanelCustomId;

  constructor(
    private readonly reasonTemplateService: ReasonTemplateService,
    private readonly emojiRepository: Pick<BotEmojiRepository, "getEmojis">,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handleInteraction(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Must be in guild.");
    }

    const action = parsePanelId(interaction.customId);
    if (!action) {
      return;
    }

    if (
      !(await requireMemberPermission(
        interaction,
        ANY_MOD_PERMISSION.flags,
        ANY_MOD_PERMISSION.name,
      ))
    ) {
      return;
    }

    const emojis = await this.emojiRepository.getEmojis(
      REASON_TEMPLATES_EMOJIS,
    );

    switch (action.action) {
      case "page":
        await this.showList(interaction, action.page, emojis);
        return;
      case "add":
        await this.add(interaction, emojis);
        return;
      case "manage":
        await this.showDetail(interaction, action, emojis);
        return;
      case "edit":
        await this.edit(interaction, action, emojis);
        return;
      case "delete":
        await this.confirmDelete(interaction, action, emojis);
        return;
      case "deleteConfirm":
        await this.delete(interaction, action, emojis);
        return;
    }
  }

  private async showList(
    interaction: ButtonInteraction<"cached">,
    page: number,
    emojis: ReasonTemplatesEmojis,
    notice: string | null = null,
  ): Promise<void> {
    const list = await this.reasonTemplateService.list(
      interaction.guildId,
      page,
    );

    await interaction.update(buildListMessage(list, emojis, notice));
  }

  private async showDetail(
    interaction: ButtonInteraction<"cached">,
    { templateId, page }: TemplateAction,
    emojis: ReasonTemplatesEmojis,
  ): Promise<void> {
    const template = await this.reasonTemplateService.get(
      interaction.guildId,
      templateId,
    );
    if (!template) {
      await this.showList(interaction, page, emojis, MISSING_TEMPLATE_NOTICE);
      return;
    }

    await interaction.update(buildDetailMessage(template, page, emojis));
  }

  private async confirmDelete(
    interaction: ButtonInteraction<"cached">,
    { templateId, page }: TemplateAction,
    emojis: ReasonTemplatesEmojis,
  ): Promise<void> {
    const template = await this.reasonTemplateService.get(
      interaction.guildId,
      templateId,
    );
    if (!template) {
      await this.showList(interaction, page, emojis, MISSING_TEMPLATE_NOTICE);
      return;
    }

    await interaction.update(buildDeleteConfirmMessage(template, page));
  }

  private async delete(
    interaction: ButtonInteraction<"cached">,
    { templateId, page }: TemplateAction,
    emojis: ReasonTemplatesEmojis,
  ): Promise<void> {
    const template = await this.reasonTemplateService.get(
      interaction.guildId,
      templateId,
    );
    const deleted = template
      ? await this.reasonTemplateService.delete(interaction.guildId, templateId)
      : false;

    this.logger.info(
      {
        guildId: interaction.guildId,
        templateId,
        deleted,
        userId: interaction.user.id,
      },
      "Reason template delete",
    );

    await this.showList(
      interaction,
      page,
      emojis,
      deleted ? deletedNotice(template) : MISSING_TEMPLATE_NOTICE,
    );
  }

  private async add(
    interaction: ButtonInteraction<"cached">,
    emojis: ReasonTemplatesEmojis,
  ): Promise<void> {
    const { total } = await this.reasonTemplateService.list(
      interaction.guildId,
      1,
    );
    if (total >= REASON_TEMPLATE_LIMIT) {
      await interaction.reply(
        buildReasonTemplateErrorMessage(
          { code: "limit_reached", limit: REASON_TEMPLATE_LIMIT },
          emojis,
        ),
      );
      return;
    }

    const submit = await showAndAwaitModal(
      interaction,
      buildTemplateFormModal(buildModalId("addModal"), null),
    );
    if (!submit || !(await requireModOnSubmit(submit, emojis))) {
      return;
    }

    const created = await this.reasonTemplateService.create(
      interaction.guildId,
      { ...readTemplateFields(submit.fields), createdBy: submit.user.id },
    );
    if (created.err) {
      await submit.reply(buildReasonTemplateErrorMessage(created.val, emojis));
      return;
    }

    // Unused and newest, so it sorts last; the service clamps to the last page.
    const list = await this.reasonTemplateService.list(
      interaction.guildId,
      Number.MAX_SAFE_INTEGER,
    );
    const message = buildListMessage(list, emojis, addedNotice(created.val));
    if (submit.isFromMessage()) {
      await submit.update(message);
    } else {
      await submit.reply(message);
    }
  }

  private async edit(
    interaction: ButtonInteraction<"cached">,
    { templateId, page }: TemplateAction,
    emojis: ReasonTemplatesEmojis,
  ): Promise<void> {
    const template = await this.reasonTemplateService.get(
      interaction.guildId,
      templateId,
    );
    if (!template) {
      await this.showList(interaction, page, emojis, MISSING_TEMPLATE_NOTICE);
      return;
    }

    const submit = await showAndAwaitModal(
      interaction,
      buildTemplateFormModal(buildModalId("editModal"), template),
    );
    if (!submit || !(await requireModOnSubmit(submit, emojis))) {
      return;
    }

    const updated = await this.reasonTemplateService.update(
      interaction.guildId,
      templateId,
      readTemplateFields(submit.fields),
    );
    if (
      updated.err &&
      updated.val.code === "not_found" &&
      submit.isFromMessage()
    ) {
      const list = await this.reasonTemplateService.list(
        interaction.guildId,
        page,
      );
      await submit.update(
        buildListMessage(list, emojis, MISSING_TEMPLATE_NOTICE),
      );
      return;
    }

    if (updated.err) {
      await submit.reply(buildReasonTemplateErrorMessage(updated.val, emojis));
      return;
    }

    const message = buildDetailMessage(updated.val, page, emojis);
    if (submit.isFromMessage()) {
      await submit.update(message);
    } else {
      await submit.reply(message);
    }
  }
}
