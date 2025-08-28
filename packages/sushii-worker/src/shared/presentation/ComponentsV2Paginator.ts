import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  ContainerBuilder,
  Message,
} from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  TextDisplayBuilder,
} from "discord.js";
import type { Logger } from "pino";

import logger from "@/shared/infrastructure/logger";

// Core types for components v2 pagination
export interface PaginationState {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  isDisabled: boolean;
  hasNavigation: boolean;
}

export interface PaginationCallbacks<T> {
  /** Fetch data for the current page */
  fetchPage: (pageIndex: number, pageSize: number) => Promise<T[]>;

  /** Get total count of items (called only when needed) */
  getTotalCount: () => Promise<number>;

  /** Render the current page data into a container */
  renderContainer: (
    data: T[],
    state: PaginationState,
    navButtons: ActionRowBuilder<ButtonBuilder> | null,
  ) => ContainerBuilder;
}

export interface PaginationConfig {
  /** Idle timeout in milliseconds for component collector */
  timeoutMs: number;

  /** Number of pages to jump with fast forward/backward buttons */
  pageJumpSize: number;

  /** Message shown to unauthorized users */
  unauthorizedMessage: string;

  /** Custom IDs for pagination buttons (optional, defaults provided) */
  buttonIds?: {
    back5?: string;
    back?: string;
    current?: string;
    forward?: string;
    forward5?: string;
  };
}

const DEFAULT_CONFIG: PaginationConfig = {
  timeoutMs: 3 * 60 * 1000, // 3 minutes
  pageJumpSize: 5,
  unauthorizedMessage:
    "These buttons aren't for you! Please run your own command.",
};

const DEFAULT_BUTTON_IDS = {
  back5: "components_v2_paginator_back5",
  back: "components_v2_paginator_back",
  current: "components_v2_paginator_current",
  forward: "components_v2_paginator_forward",
  forward5: "components_v2_paginator_forward5",
} as const;

const BUTTON_EMOJIS = {
  BACK_5: "⏪",
  BACK: "⬅️",
  FORWARD: "➡️",
  FORWARD_5: "⏩",
} as const;

export interface PaginationOptions<T> {
  interaction: ChatInputCommandInteraction<"cached">;
  pageSize: number;
  callbacks: PaginationCallbacks<T>;
  config?: Partial<PaginationConfig>;
  logger?: Logger;
}

/**
 * ComponentsV2Paginator - A library-style paginator for Discord's components v2 system.
 *
 * Features:
 * - Works with ContainerBuilder and components v2
 * - Only creates collector when totalPages > 1 (efficient)
 * - Gives full control to callers for content rendering
 * - Uses idle timeout (resets on interaction)
 * - Supports any data type T
 */
export class ComponentsV2Paginator<T> {
  private readonly interaction: ChatInputCommandInteraction<"cached">;
  private readonly pageSize: number;
  private readonly callbacks: PaginationCallbacks<T>;
  private readonly config: PaginationConfig;
  private readonly buttonIds: Record<keyof typeof DEFAULT_BUTTON_IDS, string>;
  private readonly logger: Logger;

  private currentPageIndex: number = 0;
  private cachedTotalPages: number | null = null;

  constructor(options: PaginationOptions<T>) {
    this.interaction = options.interaction;
    this.pageSize = options.pageSize;
    this.callbacks = options.callbacks;
    this.config = { ...DEFAULT_CONFIG, ...options.config };
    this.buttonIds = { ...DEFAULT_BUTTON_IDS, ...options.config?.buttonIds };
    this.logger = options.logger ?? logger;
  }

  /**
   * Get current pagination state
   */
  getState(): PaginationState {
    const totalPages = this.cachedTotalPages ?? 0;
    return {
      currentPage: this.currentPageIndex,
      totalPages,
      pageSize: this.pageSize,
      isDisabled: false,
      hasNavigation: totalPages > 1,
    };
  }

  /**
   * Navigate to a specific page
   */
  goToPage(pageIndex: number): void {
    const totalPages = this.cachedTotalPages ?? 1;
    this.currentPageIndex = Math.max(0, Math.min(pageIndex, totalPages - 1));
  }

  /**
   * Navigate relative to current page
   */
  navigateBy(delta: number): void {
    this.goToPage(this.currentPageIndex + delta);
  }

  /**
   * Get total pages, with caching
   */
  async getTotalPages(forceRefresh = false): Promise<number> {
    if (forceRefresh || this.cachedTotalPages === null) {
      const totalCount = await this.callbacks.getTotalCount();
      this.cachedTotalPages = Math.max(
        0,
        Math.ceil(totalCount / this.pageSize),
      );
    }
    return this.cachedTotalPages;
  }

  /**
   * Refresh data and re-render the current page
   * - Refreshes total count and total pages
   * - Adjusts current page if it's now beyond the last page
   * - Re-renders with fresh data
   */
  async refresh(): Promise<{
    components: ContainerBuilder[];
    flags: MessageFlags.IsComponentsV2;
    allowedMentions: { parse: [] };
  }> {
    // Force refresh total pages
    const totalPages = await this.getTotalPages(true);
    
    // Adjust current page if we're beyond the last page
    if (totalPages > 0 && this.currentPageIndex >= totalPages) {
      this.currentPageIndex = totalPages - 1;
    }
    
    // If no pages left, go to page 0
    if (totalPages === 0) {
      this.currentPageIndex = 0;
    }

    // Re-render with fresh data
    return this.renderCurrentPage();
  }

  /**
   * Render the current page with optional navigation buttons
   */
  async renderCurrentPage(options: { disabled?: boolean } = {}): Promise<{
    components: ContainerBuilder[];
    flags: MessageFlags.IsComponentsV2;
    allowedMentions: { parse: [] };
  }> {
    // Fetch current page data
    const pageData = await this.callbacks.fetchPage(
      this.currentPageIndex,
      this.pageSize,
    );

    // Get total pages for navigation
    const totalPages = await this.getTotalPages();

    // Create pagination state
    const state: PaginationState = {
      currentPage: this.currentPageIndex,
      totalPages,
      pageSize: this.pageSize,
      isDisabled: options.disabled ?? false,
      hasNavigation: totalPages > 1,
    };

    // Create navigation buttons if needed
    const navButtons =
      totalPages > 1 ? this.createNavigationButtons(options.disabled) : null;

    // Let caller render the page content
    const container = this.callbacks.renderContainer(
      pageData,
      state,
      navButtons,
    );

    return {
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    };
  }

  /**
   * Create navigation button row
   */
  createNavigationButtons(
    disabled = false,
  ): ActionRowBuilder<ButtonBuilder> | null {
    const totalPages = this.cachedTotalPages ?? 0;

    if (totalPages <= 1) {
      return null;
    }

    const isFirstPage = this.currentPageIndex === 0;
    const isLastPage = this.currentPageIndex === totalPages - 1;

    const back5Button = new ButtonBuilder()
      .setEmoji(BUTTON_EMOJIS.BACK_5)
      .setCustomId(this.buttonIds.back5)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || isFirstPage);

    const backButton = new ButtonBuilder()
      .setEmoji(BUTTON_EMOJIS.BACK)
      .setCustomId(this.buttonIds.back)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || isFirstPage);

    // Always show current/total pages, even when disabled (maintains spacing)
    const currentPageLabel =
      totalPages > 0 ? `${this.currentPageIndex + 1} / ${totalPages}` : "0 / 0";

    const currentButton = new ButtonBuilder()
      .setLabel(currentPageLabel)
      .setCustomId(this.buttonIds.current)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);

    const forwardButton = new ButtonBuilder()
      .setEmoji(BUTTON_EMOJIS.FORWARD)
      .setCustomId(this.buttonIds.forward)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || isLastPage);

    const forward5Button = new ButtonBuilder()
      .setEmoji(BUTTON_EMOJIS.FORWARD_5)
      .setCustomId(this.buttonIds.forward5)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || isLastPage);

    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      back5Button,
      backButton,
      currentButton,
      forwardButton,
      forward5Button,
    );
  }

  /**
   * Handle button interaction - returns true if handled, false if not a pagination button
   */
  async handleButtonInteraction(
    buttonInteraction: ButtonInteraction,
  ): Promise<boolean> {
    const { customId } = buttonInteraction;

    // Check if this is one of our pagination buttons
    const buttonValues = Object.values(this.buttonIds) as string[];
    if (!buttonValues.includes(customId)) {
      return false;
    }

    // Validate user
    if (buttonInteraction.user.id !== this.interaction.user.id) {
      await buttonInteraction.reply({
        content: this.config.unauthorizedMessage,
        ephemeral: true,
      });
      return true;
    }

    // Handle navigation
    const totalPages = await this.getTotalPages();
    const oldPage = this.currentPageIndex;

    switch (customId) {
      case this.buttonIds.back5:
        this.navigateBy(-this.config.pageJumpSize);
        break;
      case this.buttonIds.back:
        this.navigateBy(-1);
        break;
      case this.buttonIds.forward:
        this.navigateBy(1);
        break;
      case this.buttonIds.forward5:
        this.navigateBy(this.config.pageJumpSize);
        break;
      case this.buttonIds.current:
        // Current page button is disabled, no action
        return true;
    }

    this.logger.debug(
      {
        buttonId: customId,
        oldPage,
        newPage: this.currentPageIndex,
        totalPages,
      },
      "ComponentsV2Paginator button clicked",
    );

    // Re-render and update
    const updatedMessage = await this.renderCurrentPage();
    await buttonInteraction.update(updatedMessage);

    return true;
  }

  /**
   * Start pagination - sends initial message and sets up collector only when needed
   */
  async start(): Promise<void> {
    // Send initial message
    const initialMessage = await this.renderCurrentPage();
    const response = await this.interaction.reply(initialMessage);

    // Only set up collector if there are multiple pages
    const totalPages = await this.getTotalPages();
    if (totalPages <= 1) {
      this.logger.debug(
        { totalPages },
        "No collector needed for ComponentsV2Paginator",
      );
      return;
    }

    const message = await response.fetch();
    await this.setupCollector(message);
  }

  /**
   * Set up component collector for handling interactions
   */
  private async setupCollector(message: Message): Promise<void> {
    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      idle: this.config.timeoutMs, // Use idle timeout, not total time
    });

    collector.on("collect", async (buttonInteraction) => {
      try {
        await this.handleButtonInteraction(buttonInteraction);
      } catch (error) {
        this.logger.error(
          { err: error, buttonId: buttonInteraction.customId },
          "Error handling ComponentsV2Paginator button",
        );
      }
    });

    collector.on("end", async () => {
      try {
        this.logger.debug(
          "ComponentsV2Paginator collector ended, disabling buttons",
        );
        const disabledMessage = await this.renderCurrentPage({
          disabled: true,
        });
        await message.edit(disabledMessage);
      } catch (error) {
        this.logger.error(
          { err: error },
          "Error disabling ComponentsV2Paginator buttons",
        );
      }
    });
  }

  /**
   * Start pagination and wait for it to complete (collector ends)
   */
  async startAndWait(): Promise<void> {
    // Send initial message
    const initialMessage = await this.renderCurrentPage();
    const response = await this.interaction.reply(initialMessage);

    // Only set up collector if there are multiple pages
    const totalPages = await this.getTotalPages();
    if (totalPages <= 1) {
      this.logger.debug(
        { totalPages },
        "No collector needed for ComponentsV2Paginator",
      );
      return;
    }

    const message = await response.fetch();
    await this.setupCollectorAndWait(message);
  }

  /**
   * Set up component collector and wait for it to end
   */
  private async setupCollectorAndWait(message: Message): Promise<void> {
    return new Promise((resolve) => {
      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        idle: this.config.timeoutMs, // Use idle timeout, not total time
      });

      collector.on("collect", async (buttonInteraction) => {
        try {
          await this.handleButtonInteraction(buttonInteraction);
        } catch (error) {
          this.logger.error(
            { err: error, buttonId: buttonInteraction.customId },
            "Error handling ComponentsV2Paginator button",
          );
        }
      });

      collector.on("end", async () => {
        try {
          this.logger.debug(
            "ComponentsV2Paginator collector ended, disabling buttons",
          );
          const disabledMessage = await this.renderCurrentPage({
            disabled: true,
          });
          await message.edit(disabledMessage);
        } catch (error) {
          this.logger.error(
            { err: error },
            "Error disabling ComponentsV2Paginator buttons",
          );
        } finally {
          resolve();
        }
      });
    });
  }

  /**
   * Static helper to add standard expired footer
   */
  static addExpiredFooter(container: ContainerBuilder, message?: string): void {
    const expiredMessage =
      message ??
      "-# Session expired after 2 minutes of inactivity. Re-run the command.";

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(expiredMessage),
    );
  }

  /**
   * Static helper to add navigation section (handles null navButtons gracefully)
   */
  static addNavigationSection(
    container: ContainerBuilder,
    navButtons: ActionRowBuilder<ButtonBuilder> | null,
    isDisabled: boolean,
  ): void {
    // Add expired footer if disabled
    if (isDisabled) {
      ComponentsV2Paginator.addExpiredFooter(container);
    }

    // Add navigation buttons if they exist
    if (navButtons) {
      container.addActionRowComponents(navButtons);
    }
  }
}

/**
 * Utility function to create a paginator with sensible defaults
 */
export function createComponentsV2Paginator<T>(
  options: PaginationOptions<T>,
): ComponentsV2Paginator<T> {
  return new ComponentsV2Paginator(options);
}
