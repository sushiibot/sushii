import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  ComponentType,
  EmbedBuilder,
  Message,
} from "discord.js";
import type { Logger } from "pino";

import logger from "@/shared/infrastructure/logger";

// Configuration interface
interface PaginationConfig {
  timeoutMs: number;
  pageJumpSize: number;
  emptyPageMessage: string;
  unauthorizedMessage: string;
  expiredMessage: string;
}

// Error types
class PaginationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "PaginationError";
  }
}

class PageFetchError extends PaginationError {
  constructor(
    message: string,
    public readonly pageIndex: number,
  ) {
    super(message, "PAGE_FETCH_ERROR");
  }
}

class ComponentInteractionError extends PaginationError {
  constructor(
    message: string,
    public readonly buttonId: string,
  ) {
    super(message, "COMPONENT_INTERACTION_ERROR");
  }
}

// Function to get the actual page content
export type GetPageFn = (pageNum: number, pageSize: number) => Promise<string>;

// Function get the total number of items
export type GetTotalEntriesFn = () => Promise<number>;

// Embed modifier function, for adding title, color, fields, etc
export type EmbedModifierFn = (embed: EmbedBuilder) => EmbedBuilder;

// Export types for external use
export type { PaginationConfig, PaginationOptions };

// Constants
const DEFAULT_CONFIG: PaginationConfig = {
  timeoutMs: 3 * 60 * 1000, // 3 minutes
  pageJumpSize: 5,
  emptyPageMessage: "There's nothing here... 🤔",
  unauthorizedMessage:
    "This isn't for you!! Run your own command to use these buttons.",
  expiredMessage: "Expired, run the command again",
};

const BUTTON_EMOJIS = {
  BACK_5: "⏪",
  BACK: "⬅️",
  FORWARD: "➡️",
  FORWARD_5: "⏩",
} as const;

enum ButtonId {
  Back5 = "back5",
  Back = "back",
  Current = "current",
  Forward = "forward",
  Forward5 = "forward5",
}

interface PaginationOptions {
  interaction: ChatInputCommandInteraction<"cached">;
  getPageFn: GetPageFn;
  getTotalEntriesFn: GetTotalEntriesFn;
  pageSize: number;
  embedModifierFn: EmbedModifierFn;
  hideButtonsIfSinglePage?: boolean;
  config?: Partial<PaginationConfig>;
  logger?: Logger;
}

export default class Paginator {
  private readonly interaction: ChatInputCommandInteraction<"cached">;
  private readonly getPageDescriptionFn: GetPageFn;
  private readonly embedModifierFn: EmbedModifierFn;
  private readonly getTotalEntriesFn: GetTotalEntriesFn;
  private readonly pageSize: number;
  private readonly hideButtonsIfSinglePage: boolean;
  private readonly config: PaginationConfig;
  private readonly logger: Logger;

  private currentPageIndex: number;
  private totalPages: number | null;

  constructor({
    interaction,
    getPageFn,
    getTotalEntriesFn,
    pageSize,
    embedModifierFn,
    hideButtonsIfSinglePage = false,
    config = {},
    logger: injectedLogger = logger,
  }: PaginationOptions) {
    this.interaction = interaction;
    this.getPageDescriptionFn = getPageFn;
    this.embedModifierFn = embedModifierFn;
    this.getTotalEntriesFn = getTotalEntriesFn;
    this.pageSize = pageSize;
    this.hideButtonsIfSinglePage = hideButtonsIfSinglePage;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = injectedLogger;

    this.currentPageIndex = 0;
    this.totalPages = null;
  }

  /**
   * Get the total number of pages
   *
   * @returns The total number of pages
   */
  private async getTotalPages(forceRefresh: boolean): Promise<number> {
    // Reset cached value
    if (forceRefresh) {
      this.totalPages = null;
    }

    // Return cached value
    if (this.totalPages !== null) {
      return this.totalPages;
    }

    const totalEntries = await this.getTotalEntriesFn();
    this.totalPages = Math.ceil(totalEntries / this.pageSize);

    return this.totalPages;
  }

  /**
   * Get the embed to send
   *
   * @returns The embed to send
   */
  private async getEmbed(): Promise<EmbedBuilder> {
    try {
      const page = await this.getPageDescriptionFn(
        this.currentPageIndex,
        this.pageSize,
      );

      this.logger.debug(
        {
          pageIndex: this.currentPageIndex,
          pageSize: this.pageSize,
          page,
          pageLength: page.length,
        },
        "Fetched page",
      );

      const embed = new EmbedBuilder();

      if (page.length > 0) {
        // Discord has a 4096 character limit for embed descriptions
        if (page.length > 4096) {
          this.logger.warn(
            {
              pageLength: page.length,
              pageIndex: this.currentPageIndex,
            },
            "Page content exceeds Discord's 4096 character limit for embed descriptions",
          );
          embed.setDescription(page.substring(0, 4093) + "...");
        } else {
          embed.setDescription(page);
        }
      } else {
        embed.setDescription(this.config.emptyPageMessage);
      }

      return this.embedModifierFn(embed);
    } catch (error) {
      // Log the full error for debugging
      this.logger.error(
        {
          err: error,
          pageIndex: this.currentPageIndex,
          pageSize: this.pageSize,
        },
        "Error in paginator",
      );

      throw new PageFetchError(
        `Failed to fetch page ${this.currentPageIndex}: ${error instanceof Error ? error.message : "Unknown error"}`,
        this.currentPageIndex,
      );
    }
  }

  /**
   * Get the components to send
   *
   * @param expired disable all buttons
   * @returns Message components
   */
  private async getComponents(
    expired: boolean,
  ): Promise<ActionRowBuilder<ButtonBuilder>[]> {
    // Get forward and back pages, along with the current page on the center

    const totalPages = await this.getTotalPages(false);

    const back5Button = new ButtonBuilder()
      .setEmoji(BUTTON_EMOJIS.BACK_5)
      .setCustomId(ButtonId.Back5)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(expired || this.currentPageIndex === 0);

    const backButton = new ButtonBuilder()
      .setEmoji(BUTTON_EMOJIS.BACK)
      .setCustomId(ButtonId.Back)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(expired || this.currentPageIndex === 0);

    let currentPageLabel = `${this.currentPageIndex + 1} / ${totalPages}`;
    if (totalPages === 0) {
      currentPageLabel = "0 / 0";
    }

    if (expired) {
      currentPageLabel = this.config.expiredMessage;
    }

    const currentPage = new ButtonBuilder()
      .setLabel(currentPageLabel)
      .setCustomId(ButtonId.Current)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);

    const forwardButtonDisabled =
      expired || totalPages === 0 || this.currentPageIndex + 1 === totalPages;

    const forwardButton = new ButtonBuilder()
      .setEmoji(BUTTON_EMOJIS.FORWARD)
      .setCustomId(ButtonId.Forward)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(forwardButtonDisabled);

    const forward5Button = new ButtonBuilder()
      .setEmoji(BUTTON_EMOJIS.FORWARD_5)
      .setCustomId(ButtonId.Forward5)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(forwardButtonDisabled);

    const components = [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        back5Button,
        backButton,
        currentPage,
        forwardButton,
        forward5Button,
      ),
    ];

    return components;
  }

  /**
   * Handle navigation button interaction
   */
  private async handleNavigation(
    buttonId: string,
    totalPages: number,
  ): Promise<void> {
    switch (buttonId) {
      case ButtonId.Back5:
        this.currentPageIndex = Math.max(
          this.currentPageIndex - this.config.pageJumpSize,
          0,
        );
        break;
      case ButtonId.Back:
        this.currentPageIndex = Math.max(this.currentPageIndex - 1, 0);
        break;
      case ButtonId.Forward:
        this.currentPageIndex = Math.min(
          this.currentPageIndex + 1,
          totalPages - 1,
        );
        break;
      case ButtonId.Forward5:
        this.currentPageIndex = Math.min(
          this.currentPageIndex + this.config.pageJumpSize,
          totalPages - 1,
        );
        break;
      default:
        throw new ComponentInteractionError(
          `Unknown button custom id ${buttonId}`,
          buttonId,
        );
    }
  }

  /**
   * Handle button interaction
   */
  private async handleButtonInteraction(i: ButtonInteraction): Promise<void> {
    try {
      if (i.user.id !== this.interaction.user.id) {
        await i.reply({
          content: this.config.unauthorizedMessage,
          ephemeral: true,
        });
        return;
      }

      const totalPages = await this.getTotalPages(false);

      this.logger.debug({
        message: "Paginator button pressed",
        buttonId: i.customId,
        totalPages,
        currentPage: this.currentPageIndex,
      });

      await this.handleNavigation(i.customId, totalPages);

      const embed = await this.getEmbed();
      const components = await this.getComponents(false);

      await i.update({
        embeds: [embed],
        components,
      });
    } catch (err) {
      this.logger.error(err, "Error while handling paginator button press");
      throw err;
    }
  }

  /**
   * Setup and manage the component collector
   */
  private async setupCollector(message: Message | null): Promise<void> {
    if (!message) {
      return;
    }
    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      // Idle, not time -- wait AFTER inactivity, not just total time
      idle: this.config.timeoutMs,
    });

    collector.on("collect", (i) => this.handleButtonInteraction(i));

    return new Promise<void>((resolve) => {
      collector.on("end", async () => {
        try {
          this.logger.debug("Collector ended, disabling buttons");

          const components = await this.getComponents(true);
          await message.edit({ components });
          resolve();
        } catch (err) {
          this.logger.error(err, "Error while disabling buttons");
          resolve();
        }
      });
    });
  }

  /**
   * Send initial pagination message
   */
  private async sendInitialMessage(): Promise<{
    message: Message | null;
    shouldContinue: boolean;
  }> {
    const embed = await this.getEmbed();
    const totalPages = await this.getTotalPages(false);

    this.logger.debug(
      {
        embed,
        totalPages,
      },
      "starting pagination",
    );

    if (this.hideButtonsIfSinglePage && totalPages <= 0) {
      this.logger.debug("no pages, so no buttons");
      try {
        await this.interaction.reply({
          embeds: [embed],
        });
      } catch (error) {
        this.logger.error(
          {
            err: error,
            embedData: embed.toJSON(),
          },
          "Failed to send initial reply (no buttons)",
        );
        throw error;
      }
      return { message: null, shouldContinue: false };
    }

    const components = await this.getComponents(false);
    try {
      const response = await this.interaction.reply({
        embeds: [embed],
        components,
      });

      // Get the actual message from the interaction response
      const message = await response.fetch();

      if (totalPages < 1) {
        this.logger.debug(
          { totalPages },
          "no need to listen for button presses",
        );
        return { message, shouldContinue: false };
      }

      return { message, shouldContinue: true };
    } catch (error) {
      this.logger.error(
        {
          err: error,
          embedData: embed.toJSON(),
          componentsData: components.map((row) => row.toJSON()),
        },
        "Failed to send initial reply with buttons",
      );
      throw error;
    }
  }

  /**
   * Main pagination method
   */
  async paginate(): Promise<void> {
    const { message, shouldContinue } = await this.sendInitialMessage();

    if (!shouldContinue) {
      return;
    }

    await this.setupCollector(message);
  }
}

/**
 * Builder class for creating Paginator instances with fluent interface
 */
export class PaginatorBuilder {
  private options: Partial<PaginationOptions> = {};

  static create(): PaginatorBuilder {
    return new PaginatorBuilder();
  }

  withInteraction(
    interaction: ChatInputCommandInteraction<"cached">,
  ): PaginatorBuilder {
    this.options.interaction = interaction;
    return this;
  }

  withPageFn(getPageFn: GetPageFn): PaginatorBuilder {
    this.options.getPageFn = getPageFn;
    return this;
  }

  withTotalEntriesFn(getTotalEntriesFn: GetTotalEntriesFn): PaginatorBuilder {
    this.options.getTotalEntriesFn = getTotalEntriesFn;
    return this;
  }

  withPageSize(pageSize: number): PaginatorBuilder {
    this.options.pageSize = pageSize;
    return this;
  }

  withEmbedModifier(embedModifierFn: EmbedModifierFn): PaginatorBuilder {
    this.options.embedModifierFn = embedModifierFn;
    return this;
  }

  withHideButtonsIfSinglePage(hide: boolean = true): PaginatorBuilder {
    this.options.hideButtonsIfSinglePage = hide;
    return this;
  }

  withConfig(config: Partial<PaginationConfig>): PaginatorBuilder {
    this.options.config = { ...this.options.config, ...config };
    return this;
  }

  withLogger(logger: Logger): PaginatorBuilder {
    this.options.logger = logger;
    return this;
  }

  withTimeout(timeoutMs: number): PaginatorBuilder {
    this.options.config = { ...this.options.config, timeoutMs };
    return this;
  }

  withPageJumpSize(pageJumpSize: number): PaginatorBuilder {
    this.options.config = { ...this.options.config, pageJumpSize };
    return this;
  }

  withCustomMessages(messages: {
    emptyPage?: string;
    unauthorized?: string;
    expired?: string;
  }): PaginatorBuilder {
    this.options.config = {
      ...this.options.config,
      ...(messages.emptyPage && { emptyPageMessage: messages.emptyPage }),
      ...(messages.unauthorized && {
        unauthorizedMessage: messages.unauthorized,
      }),
      ...(messages.expired && { expiredMessage: messages.expired }),
    };
    return this;
  }

  build(): Paginator {
    if (!this.options.interaction) {
      throw new PaginationError(
        "Interaction is required",
        "MISSING_INTERACTION",
      );
    }

    if (!this.options.getPageFn) {
      throw new PaginationError("Page function is required", "MISSING_PAGE_FN");
    }

    if (!this.options.getTotalEntriesFn) {
      throw new PaginationError(
        "Total entries function is required",
        "MISSING_TOTAL_ENTRIES_FN",
      );
    }

    if (!this.options.pageSize) {
      throw new PaginationError("Page size is required", "MISSING_PAGE_SIZE");
    }

    if (!this.options.embedModifierFn) {
      throw new PaginationError(
        "Embed modifier function is required",
        "MISSING_EMBED_MODIFIER_FN",
      );
    }

    return new Paginator(this.options as PaginationOptions);
  }
}

// Export error classes for use in other modules
export { PaginationError, PageFetchError, ComponentInteractionError };
