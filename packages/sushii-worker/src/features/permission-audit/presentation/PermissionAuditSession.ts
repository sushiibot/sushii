import { sleep } from "bun";
import type {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ChatInputCommandInteraction,
  ComponentEmojiResolvable,
  ContainerBuilder,
} from "discord.js";
import { ComponentType, MessageFlags } from "discord.js";
import type { Logger } from "pino";

import { isFeedbackCustomId } from "@/features/feedback/presentation/customIds";
import { getErrorMessage } from "@/interactions/responses/error";
import { ComponentsV2Paginator } from "@/shared/presentation/ComponentsV2Paginator";

import type { PermissionAuditService } from "../application/PermissionAuditService";
import type { AuditResult } from "../application/PermissionAuditService";
import type { PermissionChangeService } from "../application/PermissionChangeService";
import { type PlannedChange, planChange } from "../domain/planChange";
import { PERMISSION_AUDIT_CUSTOM_IDS, parseFixCustomId } from "./customIds";
import {
  type FixOutcome,
  createFixPreview,
  createFixResult,
} from "./views/FixPreviewBuilder";
import {
  type AuditPages,
  type AuditViewTab,
  PERMISSION_AUDIT_IDLE_TIMEOUT_MS,
  type PageBlock,
  type PagedTab,
  TAB_BY_CUSTOM_ID,
  buildAuditPages,
  createAuditMessage,
  isCleanAudit,
} from "./views/PermissionAuditMessageBuilder";

const REJECTION_MESSAGE =
  "These controls belong to whoever ran this audit — run your own `/permission-audit`.";

type AuditMessage = ReturnType<typeof createAuditMessage>;

/** One audit message, its collector, and the tab/page/fix state for its lifetime. */
export class PermissionAuditSession {
  private activeTab: AuditViewTab = "overview";
  private paginator: ComponentsV2Paginator<PageBlock[]> | null = null;
  private result: AuditResult;
  private pages: AuditPages;
  private pendingChange: PlannedChange | null = null;
  /** Re-shown to a repeat Confirm click, whose earlier response may not have reached the user. */
  private lastFixResult: ReturnType<typeof createFixResult> | null = null;
  private applying = false;
  private returnPage = 0;
  /** Set after a change: the report is rebuilt when the user goes back to it. */
  private needsRefresh = false;
  /**
   * Expiry edits through an interaction webhook, which works even where
   * sushii can't view the channel. Each token lasts 15 minutes, and the
   * latest click is never older than the idle timeout.
   */
  private latestInteraction:
    | ChatInputCommandInteraction<"cached">
    | ButtonInteraction<"cached">;

  constructor(
    private readonly interaction: ChatInputCommandInteraction<"cached">,
    result: AuditResult,
    private readonly auditService: PermissionAuditService,
    private readonly changeService: PermissionChangeService,
    private readonly logger: Logger,
    private readonly feedbackEmoji?: ComponentEmojiResolvable,
  ) {
    this.result = result;
    this.pages = buildAuditPages(result, interaction.guildId);
    this.latestInteraction = interaction;
  }

  async start(): Promise<void> {
    const msg = await this.interaction.editReply({
      ...this.renderScreen(false),
      flags: MessageFlags.IsComponentsV2,
    });

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      idle: PERMISSION_AUDIT_IDLE_TIMEOUT_MS,
      // The feedback button belongs to the global router.
      filter: (i) => !isFeedbackCustomId(i.customId),
    });

    collector.on("collect", async (i) => {
      try {
        if (i.user.id !== this.interaction.user.id) {
          const rejection = await i.reply({
            content: REJECTION_MESSAGE,
            flags: MessageFlags.Ephemeral,
          });
          await sleep(2500);
          await rejection.delete();
          return;
        }

        this.latestInteraction = i;
        await this.handleButton(i);
      } catch (err) {
        this.logger.error(
          { err, customId: i.customId, guildId: this.interaction.guildId },
          "Failed to handle permission audit interaction",
        );

        try {
          if (!i.replied && !i.deferred) {
            await i.reply(
              getErrorMessage(
                "Failed to handle permission audit interaction",
                "Something went wrong. Try again.",
                true,
              ),
            );
          }
        } catch (ackErr) {
          this.logger.error(
            { err: ackErr, guildId: this.interaction.guildId },
            "Failed to acknowledge permission audit interaction after error",
          );
        }
      }
    });

    collector.on("end", async () => {
      // The Feedback button is router-handled, so a clean result has nothing to disable.
      if (isCleanAudit(this.result)) {
        return;
      }

      try {
        await this.latestInteraction.editReply(await this.renderExpired());
      } catch (err) {
        this.logger.error(
          { err, guildId: this.interaction.guildId },
          "Failed to disable permission audit components",
        );
      }
    });
  }

  private async handleButton(i: ButtonInteraction<"cached">): Promise<void> {
    if (this.paginator && (await this.paginator.handleButtonInteraction(i))) {
      return;
    }

    const fixIndex = parseFixCustomId(i.customId);
    if (fixIndex !== null) {
      await this.openFix(i, fixIndex);
      return;
    }

    switch (i.customId) {
      case PERMISSION_AUDIT_CUSTOM_IDS.confirm:
        await this.confirmFix(i);
        return;
      case PERMISSION_AUDIT_CUSTOM_IDS.cancel:
      case PERMISSION_AUDIT_CUSTOM_IDS.back:
        this.pendingChange = null;
        this.lastFixResult = null;
        await this.returnToReport(i);
        return;
    }

    const tab = TAB_BY_CUSTOM_ID.get(i.customId);
    if (tab) {
      await this.showTab(i, tab, 0);
      return;
    }

    this.logger.warn(
      { customId: i.customId, guildId: this.interaction.guildId },
      "Unknown permission audit button",
    );
  }

  private async openFix(
    i: ButtonInteraction<"cached">,
    findingIndex: number,
  ): Promise<void> {
    const rated = this.result.report.findings[findingIndex];
    const change = rated
      ? planChange(rated.finding, this.result.snapshot)
      : null;
    if (!change) {
      await i.update(await this.renderReport(false));
      return;
    }

    this.returnPage = this.paginator?.getState().currentPage ?? 0;
    this.pendingChange = change;
    this.lastFixResult = null;

    const authorized = this.changeService.authorize(i.guild, i.member, change);
    await i.update(
      createFixPreview({
        change,
        snapshot: this.result.snapshot,
        refusal: authorized.err ? authorized.val : null,
      }),
    );
  }

  private async confirmFix(i: ButtonInteraction<"cached">): Promise<void> {
    // Claimed before any await, so a double click can't apply it twice.
    const change = this.pendingChange;
    this.pendingChange = null;

    if (!change) {
      if (this.applying) {
        // defer: ack-only, the first click is still applying and renders the result itself
        await i.deferUpdate();
        return;
      }
      await i.update(this.lastFixResult ?? (await this.renderReport(false)));
      return;
    }

    let outcome: FixOutcome;
    this.applying = true;
    try {
      const applied = await this.changeService.apply(i.guild, i.member, change);
      outcome = applied.ok
        ? { ok: true, warning: applied.val.warning }
        : { ok: false, message: applied.val };
    } catch (err) {
      this.logger.error(
        { err, guildId: i.guildId, kind: change.kind },
        "Failed to apply permission audit change",
      );
      outcome = {
        ok: false,
        message: `Discord rejected the change: ${err instanceof Error ? err.message : String(err)}`,
      };
    } finally {
      this.applying = false;
    }

    // Shown before refreshing: the gateway may not have updated the cache yet,
    // and a refresh failure must not hide that the change went through.
    this.needsRefresh ||= outcome.ok;
    this.lastFixResult = createFixResult(change, this.result.snapshot, outcome);
    await i.update(this.lastFixResult);
  }

  private async returnToReport(i: ButtonInteraction<"cached">): Promise<void> {
    if (!this.needsRefresh) {
      await this.showTab(i, this.activeTab, this.returnPage);
      return;
    }

    // defer: regenerating the audit fetches guild members from Discord
    await i.deferUpdate();
    this.result = await this.auditService.generate(i.guild);
    this.pages = buildAuditPages(this.result, i.guildId);
    this.needsRefresh = false;
    await this.selectTab(i, this.activeTab, this.returnPage);
    await i.editReply(await this.renderReport(false));
  }

  private async showTab(
    i: ButtonInteraction<"cached">,
    tab: AuditViewTab,
    page: number,
  ): Promise<void> {
    await this.selectTab(i, tab, page);
    await i.update(await this.renderReport(false));
  }

  private async selectTab(
    i: ButtonInteraction<"cached">,
    tab: AuditViewTab,
    page: number,
  ): Promise<void> {
    this.lastFixResult = null;
    this.activeTab = tab;
    this.paginator = tab === "overview" ? null : this.createPaginator(i, tab);

    if (this.paginator) {
      await this.paginator.getTotalPages();
      this.paginator.goToPage(page);
    }
  }

  private createPaginator(
    i: ButtonInteraction<"cached">,
    tab: PagedTab,
  ): ComponentsV2Paginator<PageBlock[]> {
    const pages = this.pages[tab];

    return new ComponentsV2Paginator<PageBlock[]>({
      interaction: i,
      pageSize: 1,
      logger: this.logger,
      callbacks: {
        fetchPage: async (pageIndex) =>
          pages[pageIndex] ? [pages[pageIndex]] : [],
        getTotalCount: async () => pages.length,
        renderContainer: ([page], state, navButtons) =>
          this.renderContainer(state.isDisabled, page ?? [], navButtons),
      },
    });
  }

  private async renderReport(disabled: boolean): Promise<AuditMessage> {
    if (this.paginator) {
      return this.paginator.renderCurrentPage({ disabled });
    }

    return this.renderScreen(disabled);
  }

  private async renderExpired(): Promise<AuditMessage> {
    return this.renderReport(true);
  }

  /** The paginator sends only this container, so it must be the whole frame. */
  private renderContainer(
    disabled: boolean,
    pageBlocks: readonly PageBlock[],
    navButtons: ActionRowBuilder<ButtonBuilder> | null,
  ): ContainerBuilder {
    return createAuditMessage({
      result: this.result,
      pages: this.pages,
      everyoneRoleId: this.interaction.guildId,
      tab: this.activeTab,
      pageBlocks,
      navButtons,
      disabled,
      feedbackEmoji: this.feedbackEmoji,
    }).components[0];
  }

  private renderScreen(disabled: boolean): AuditMessage {
    return createAuditMessage({
      result: this.result,
      pages: this.pages,
      everyoneRoleId: this.interaction.guildId,
      tab: this.activeTab,
      disabled,
      feedbackEmoji: this.feedbackEmoji,
    });
  }
}
