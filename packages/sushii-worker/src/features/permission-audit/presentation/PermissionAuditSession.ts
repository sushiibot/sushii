import { sleep } from "bun";
import type {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ChatInputCommandInteraction,
  ContainerBuilder,
} from "discord.js";
import { ComponentType, MessageFlags } from "discord.js";
import type { Logger } from "pino";

import { getErrorMessage } from "@/interactions/responses/error";
import { ComponentsV2Paginator } from "@/shared/presentation/ComponentsV2Paginator";

import type { AuditResult } from "../application/PermissionAuditService";
import {
  type AuditPages,
  type AuditViewTab,
  PERMISSION_AUDIT_IDLE_TIMEOUT_MS,
  type PagedTab,
  TAB_BY_CUSTOM_ID,
  buildAuditPages,
  createAuditMessage,
} from "./views/PermissionAuditMessageBuilder";

const REJECTION_MESSAGE =
  "These controls belong to whoever ran this audit — run your own `/permission-audit`.";

type AuditMessage = ReturnType<typeof createAuditMessage>;

/** One audit message, its collector, and the tab/page state for its lifetime. */
export class PermissionAuditSession {
  private activeTab: AuditViewTab = "overview";
  private paginator: ComponentsV2Paginator<string[]> | null = null;
  private readonly pages: AuditPages;
  /**
   * Ephemeral messages can only be edited through an interaction webhook, and
   * each token lasts 15 minutes. The latest click is never older than the
   * idle timeout, so expiry edits through it.
   */
  private latestInteraction:
    | ChatInputCommandInteraction<"cached">
    | ButtonInteraction<"cached">;

  constructor(
    private readonly interaction: ChatInputCommandInteraction<"cached">,
    private readonly result: AuditResult,
    private readonly logger: Logger,
  ) {
    this.pages = buildAuditPages(result, interaction.guildId);
    this.latestInteraction = interaction;
  }

  async start(): Promise<void> {
    const response = await this.interaction.reply({
      ...this.renderScreen(false),
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      withResponse: true,
    });
    const msg = response.resource?.message;
    if (!msg) {
      throw new Error("Permission audit reply did not return a message");
    }

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      idle: PERMISSION_AUDIT_IDLE_TIMEOUT_MS,
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

    const tab = TAB_BY_CUSTOM_ID.get(i.customId);
    if (!tab) {
      this.logger.warn(
        { customId: i.customId, guildId: this.interaction.guildId },
        "Unknown permission audit button",
      );
      return;
    }

    this.activeTab = tab;
    this.paginator = tab === "overview" ? null : this.createPaginator(i, tab);

    await i.update(
      this.paginator
        ? await this.paginator.renderCurrentPage()
        : this.renderScreen(false),
    );
  }

  private createPaginator(
    i: ButtonInteraction<"cached">,
    tab: PagedTab,
  ): ComponentsV2Paginator<string[]> {
    const pages = this.pages[tab];

    return new ComponentsV2Paginator<string[]>({
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

  private async renderExpired(): Promise<AuditMessage> {
    if (this.paginator) {
      return this.paginator.renderCurrentPage({ disabled: true });
    }

    return this.renderScreen(true);
  }

  /** The paginator sends only this container, so it must be the whole frame. */
  private renderContainer(
    disabled: boolean,
    pageBlocks: readonly string[],
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
    }).components[0];
  }

  private renderScreen(disabled: boolean): AuditMessage {
    return createAuditMessage({
      result: this.result,
      pages: this.pages,
      everyoneRoleId: this.interaction.guildId,
      tab: this.activeTab,
      disabled,
    });
  }
}
