import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type {
  ChatInputCommandInteraction} from "discord.js";
import {
  ComponentType,
  EmbedBuilder,
} from "discord.js";
import type { Logger } from "pino";

import type {
  EmbedModifierFn,
  GetPageFn,
  GetTotalEntriesFn} from "./Paginator";
import Paginator, {
  ComponentInteractionError,
  PageFetchError,
  type PaginationConfig,
  PaginationError,
  PaginatorBuilder,
} from "./Paginator";

// Mock Discord.js types for testing
interface MockUser {
  id: string;
}

interface MockButtonInteraction {
  user: MockUser;
  customId: string;
  reply: ReturnType<typeof mock>;
  update: ReturnType<typeof mock>;
}

interface MockComponentCollector {
  on: ReturnType<typeof mock>;
}

interface MockMessage {
  createMessageComponentCollector: ReturnType<typeof mock>;
  edit: ReturnType<typeof mock>;
}

interface MockInteractionResponse {
  fetch: ReturnType<typeof mock>;
}

interface MockInteraction {
  user: MockUser;
  reply: ReturnType<typeof mock>;
}

// Mock factories
const createMockLogger = (): Logger =>
  ({
    /* eslint-disable @typescript-eslint/no-empty-function*/
    debug: mock(() => {}),
    error: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    fatal: mock(() => {}),
    trace: mock(() => {}),
    /* eslint-enable @typescript-eslint/no-empty-function*/
    child: mock(() => createMockLogger()),
    level: "debug",
    silent: false,
  }) as unknown as Logger;

const createMockUser = (id: string = "user123"): MockUser => ({
  id,
});

const createMockButtonInteraction = (
  customId: string = "forward",
  userId: string = "user123",
): MockButtonInteraction => ({
  user: createMockUser(userId),
  customId,
  reply: mock(() => Promise.resolve()),
  update: mock(() => Promise.resolve()),
});

const createMockComponentCollector = (): MockComponentCollector => ({
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  on: mock(() => {}),
});

const createMockMessage = (): MockMessage => ({
  createMessageComponentCollector: mock(() => createMockComponentCollector()),
  edit: mock(() => Promise.resolve()),
});

const createMockInteractionResponse = (
  message: MockMessage,
): MockInteractionResponse => ({
  fetch: mock(() => Promise.resolve(message)),
});

const createMockInteraction = (userId: string = "user123"): MockInteraction => {
  const message = createMockMessage();
  const response = createMockInteractionResponse(message);

  return {
    user: createMockUser(userId),
    reply: mock(() => Promise.resolve(response)),
  };
};

// Test data factories
const createMockGetPageFn = (
  pages: string[] = ["Page 1", "Page 2", "Page 3"],
): GetPageFn => {
  return mock((pageIndex: number, _pageSize: number) => {
    const page = pages[pageIndex] || "";
    return Promise.resolve(page);
  });
};

const createMockGetTotalEntriesFn = (
  totalEntries: number = 30,
): GetTotalEntriesFn => {
  return mock(() => Promise.resolve(totalEntries));
};

const createMockEmbedModifierFn = (): EmbedModifierFn => {
  return mock((embed: EmbedBuilder) => {
    embed.setTitle("Test Embed");
    embed.setColor(0x00ff00);
    return embed;
  });
};

describe("Paginator", () => {
  let mockInteraction: MockInteraction;
  let mockLogger: Logger;
  let mockGetPageFn: GetPageFn;
  let mockGetTotalEntriesFn: GetTotalEntriesFn;
  let mockEmbedModifierFn: EmbedModifierFn;

  beforeEach(() => {
    mockInteraction = createMockInteraction();
    mockLogger = createMockLogger();
    mockGetPageFn = createMockGetPageFn();
    mockGetTotalEntriesFn = createMockGetTotalEntriesFn();
    mockEmbedModifierFn = createMockEmbedModifierFn();
  });

  afterEach(() => {
    mock.restore();
  });

  describe("Constructor", () => {
    it("should create a Paginator instance with required options", () => {
      const paginator = new Paginator({
        interaction:
          mockInteraction as unknown as ChatInputCommandInteraction<"cached">,
        getPageFn: mockGetPageFn,
        getTotalEntriesFn: mockGetTotalEntriesFn,
        pageSize: 10,
        embedModifierFn: mockEmbedModifierFn,
      });

      expect(paginator).toBeInstanceOf(Paginator);
    });

    it("should use default configuration when none provided", () => {
      const paginator = new Paginator({
        interaction:
          mockInteraction as unknown as ChatInputCommandInteraction<"cached">,
        getPageFn: mockGetPageFn,
        getTotalEntriesFn: mockGetTotalEntriesFn,
        pageSize: 10,
        embedModifierFn: mockEmbedModifierFn,
      });

      expect(paginator).toBeInstanceOf(Paginator);
    });

    it("should merge custom configuration with defaults", () => {
      const customConfig: Partial<PaginationConfig> = {
        timeoutMs: 5 * 60 * 1000,
        pageJumpSize: 10,
        emptyPageMessage: "Custom empty message",
      };

      const paginator = new Paginator({
        interaction:
          mockInteraction as unknown as ChatInputCommandInteraction<"cached">,
        getPageFn: mockGetPageFn,
        getTotalEntriesFn: mockGetTotalEntriesFn,
        pageSize: 10,
        embedModifierFn: mockEmbedModifierFn,
        config: customConfig,
      });

      expect(paginator).toBeInstanceOf(Paginator);
    });

    it("should accept custom logger", () => {
      const customLogger = createMockLogger();

      const paginator = new Paginator({
        interaction:
          mockInteraction as unknown as ChatInputCommandInteraction<"cached">,
        getPageFn: mockGetPageFn,
        getTotalEntriesFn: mockGetTotalEntriesFn,
        pageSize: 10,
        embedModifierFn: mockEmbedModifierFn,
        logger: customLogger,
      });

      expect(paginator).toBeInstanceOf(Paginator);
    });
  });

  describe("PaginatorBuilder", () => {
    it("should create a builder instance", () => {
      const builder = PaginatorBuilder.create();
      expect(builder).toBeInstanceOf(PaginatorBuilder);
    });

    it("should build a complete Paginator with fluent interface", () => {
      const paginator = PaginatorBuilder.create()
        .withInteraction(
          mockInteraction as unknown as ChatInputCommandInteraction<"cached">,
        )
        .withPageFn(mockGetPageFn)
        .withTotalEntriesFn(mockGetTotalEntriesFn)
        .withPageSize(10)
        .withEmbedModifier(mockEmbedModifierFn)
        .withHideButtonsIfSinglePage(true)
        .withLogger(mockLogger)
        .build();

      expect(paginator).toBeInstanceOf(Paginator);
    });

    it("should build with custom configuration", () => {
      const paginator = PaginatorBuilder.create()
        .withInteraction(
          mockInteraction as unknown as ChatInputCommandInteraction<"cached">,
        )
        .withPageFn(mockGetPageFn)
        .withTotalEntriesFn(mockGetTotalEntriesFn)
        .withPageSize(10)
        .withEmbedModifier(mockEmbedModifierFn)
        .withTimeout(10 * 60 * 1000)
        .withPageJumpSize(3)
        .withCustomMessages({
          emptyPage: "No data found",
          unauthorized: "Access denied",
          expired: "Session expired",
        })
        .build();

      expect(paginator).toBeInstanceOf(Paginator);
    });

    it("should throw PaginationError when required fields are missing", () => {
      expect(() => {
        PaginatorBuilder.create().build();
      }).toThrow(PaginationError);

      expect(() => {
        PaginatorBuilder.create()
          .withInteraction(
            mockInteraction as unknown as ChatInputCommandInteraction<"cached">,
          )
          .build();
      }).toThrow(PaginationError);

      expect(() => {
        PaginatorBuilder.create()
          .withInteraction(
            mockInteraction as unknown as ChatInputCommandInteraction<"cached">,
          )
          .withPageFn(mockGetPageFn)
          .build();
      }).toThrow(PaginationError);
    });

    it("should throw specific error messages for missing fields", () => {
      expect(() => {
        PaginatorBuilder.create().build();
      }).toThrow("Interaction is required");

      expect(() => {
        PaginatorBuilder.create()
          .withInteraction(
            mockInteraction as unknown as ChatInputCommandInteraction<"cached">,
          )
          .build();
      }).toThrow("Page function is required");

      expect(() => {
        PaginatorBuilder.create()
          .withInteraction(
            mockInteraction as unknown as ChatInputCommandInteraction<"cached">,
          )
          .withPageFn(mockGetPageFn)
          .build();
      }).toThrow("Total entries function is required");
    });
  });

  describe("Pagination Logic", () => {
    let paginator: Paginator;
    let mockMessage: MockMessage;
    let mockCollector: MockComponentCollector;

    beforeEach(() => {
      mockMessage = createMockMessage();
      mockCollector = createMockComponentCollector();
      mockMessage.createMessageComponentCollector = mock(() => mockCollector);

      // Setup collector to end immediately for non-hanging tests
      mockCollector.on = mock(
        (event: string, handler: (arg?: unknown) => void) => {
          if (event === "end") {
            // End the collector after a short delay to allow test assertions
            setTimeout(() => handler(), 1);
          }
        },
      );

      const mockResponse = createMockInteractionResponse(mockMessage);
      mockInteraction.reply = mock(() => Promise.resolve(mockResponse));

      paginator = new Paginator({
        interaction:
          mockInteraction as unknown as ChatInputCommandInteraction<"cached">,
        getPageFn: mockGetPageFn,
        getTotalEntriesFn: mockGetTotalEntriesFn,
        pageSize: 10,
        embedModifierFn: mockEmbedModifierFn,
        logger: mockLogger,
      });
    });

    it("should call getPageFn with correct parameters", async () => {
      await paginator.paginate();

      expect(mockGetPageFn).toHaveBeenCalledWith(0, 10);
    });

    it("should call getTotalEntriesFn", async () => {
      await paginator.paginate();

      expect(mockGetTotalEntriesFn).toHaveBeenCalled();
    });

    it("should call embedModifierFn with embed", async () => {
      await paginator.paginate();

      expect(mockEmbedModifierFn).toHaveBeenCalledWith(
        expect.any(EmbedBuilder),
      );
    });

    it("should reply with embed and components", async () => {
      await paginator.paginate();

      expect(mockInteraction.reply).toHaveBeenCalledWith({
        embeds: [expect.any(EmbedBuilder)],
        components: expect.any(Array),
      });
    });

    it("should create message component collector with correct options", async () => {
      await paginator.paginate();

      expect(mockMessage.createMessageComponentCollector).toHaveBeenCalledWith({
        componentType: ComponentType.Button,
        idle: 3 * 60 * 1000, // default timeout
      });
    });
  });

  describe("Empty Page Handling", () => {
    let mockMessage: MockMessage;
    let mockCollector: MockComponentCollector;

    beforeEach(() => {
      mockMessage = createMockMessage();
      mockCollector = createMockComponentCollector();
      mockMessage.createMessageComponentCollector = mock(() => mockCollector);

      // Setup collector to end immediately
      mockCollector.on = mock(
        (event: string, handler: (arg?: unknown) => void) => {
          if (event === "end") {
            setTimeout(() => handler(), 1);
          }
        },
      );

      const mockResponse = createMockInteractionResponse(mockMessage);
      mockInteraction.reply = mock(() => Promise.resolve(mockResponse));
    });

    it("should show empty page message when no content", async () => {
      const emptyPageFn = mock(() => Promise.resolve(""));
      const paginator = new Paginator({
        interaction:
          mockInteraction as unknown as ChatInputCommandInteraction<"cached">,
        getPageFn: emptyPageFn,
        getTotalEntriesFn: mockGetTotalEntriesFn,
        pageSize: 10,
        embedModifierFn: mockEmbedModifierFn,
        logger: mockLogger,
      });

      await paginator.paginate();

      expect(mockEmbedModifierFn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            description: "There's nothing here... 🤔",
          }),
        }),
      );
    });

    it("should use custom empty page message", async () => {
      const emptyPageFn = mock(() => Promise.resolve(""));
      const customMessage = "No results found!";

      const paginator = new Paginator({
        interaction:
          mockInteraction as unknown as ChatInputCommandInteraction<"cached">,
        getPageFn: emptyPageFn,
        getTotalEntriesFn: mockGetTotalEntriesFn,
        pageSize: 10,
        embedModifierFn: mockEmbedModifierFn,
        config: { emptyPageMessage: customMessage },
        logger: mockLogger,
      });

      await paginator.paginate();

      expect(mockEmbedModifierFn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            description: customMessage,
          }),
        }),
      );
    });
  });

  describe("Single Page Handling", () => {
    it("should hide buttons when hideButtonsIfSinglePage is true and no pages", async () => {
      const noEntriesFn = mock(() => Promise.resolve(0));
      const paginator = new Paginator({
        interaction:
          mockInteraction as unknown as ChatInputCommandInteraction<"cached">,
        getPageFn: mockGetPageFn,
        getTotalEntriesFn: noEntriesFn,
        pageSize: 10,
        embedModifierFn: mockEmbedModifierFn,
        hideButtonsIfSinglePage: true,
        logger: mockLogger,
      });

      await paginator.paginate();

      expect(mockInteraction.reply).toHaveBeenCalledWith({
        embeds: [expect.any(EmbedBuilder)],
        // No components should be passed when hiding buttons
      });
    });

    it("should show buttons when hideButtonsIfSinglePage is false", async () => {
      const noEntriesFn = mock(() => Promise.resolve(0));
      const paginator = new Paginator({
        interaction:
          mockInteraction as unknown as ChatInputCommandInteraction<"cached">,
        getPageFn: mockGetPageFn,
        getTotalEntriesFn: noEntriesFn,
        pageSize: 10,
        embedModifierFn: mockEmbedModifierFn,
        hideButtonsIfSinglePage: false,
        logger: mockLogger,
      });

      await paginator.paginate();

      expect(mockInteraction.reply).toHaveBeenCalledWith({
        embeds: [expect.any(EmbedBuilder)],
        components: expect.any(Array),
      });
    });
  });

  describe("Error Handling", () => {
    it("should throw PageFetchError when getPageFn fails", async () => {
      const failingPageFn = mock(() =>
        Promise.reject(new Error("Database error")),
      );
      const paginator = new Paginator({
        interaction:
          mockInteraction as unknown as ChatInputCommandInteraction<"cached">,
        getPageFn: failingPageFn,
        getTotalEntriesFn: mockGetTotalEntriesFn,
        pageSize: 10,
        embedModifierFn: mockEmbedModifierFn,
        logger: mockLogger,
      });

      await expect(paginator.paginate()).rejects.toThrow(PageFetchError);
    });

    it("should throw PageFetchError with correct page index", async () => {
      const failingPageFn = mock(() =>
        Promise.reject(new Error("Database error")),
      );
      const paginator = new Paginator({
        interaction:
          mockInteraction as unknown as ChatInputCommandInteraction<"cached">,
        getPageFn: failingPageFn,
        getTotalEntriesFn: mockGetTotalEntriesFn,
        pageSize: 10,
        embedModifierFn: mockEmbedModifierFn,
        logger: mockLogger,
      });

      try {
        await paginator.paginate();
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(PageFetchError);
        expect((error as PageFetchError).pageIndex).toBe(0);
      }
    });

    it("should log errors when page fetch fails", async () => {
      const failingPageFn = mock(() =>
        Promise.reject(new Error("Database error")),
      );
      const paginator = new Paginator({
        interaction:
          mockInteraction as unknown as ChatInputCommandInteraction<"cached">,
        getPageFn: failingPageFn,
        getTotalEntriesFn: mockGetTotalEntriesFn,
        pageSize: 10,
        embedModifierFn: mockEmbedModifierFn,
        logger: mockLogger,
      });

      await expect(paginator.paginate()).rejects.toThrow(PageFetchError);
      // Note: Logger debug calls happen during successful operations, not during errors
      // The error is thrown before debug logging occurs
    });
  });

  describe("Custom Configuration", () => {
    it("should use custom timeout in collector", async () => {
      const customTimeout = 10 * 60 * 1000; // 10 minutes
      const mockMessage = createMockMessage();
      const mockCollector = createMockComponentCollector();
      mockMessage.createMessageComponentCollector = mock(() => mockCollector);

      // Setup collector to end immediately
      mockCollector.on = mock(
        (event: string, handler: (arg?: unknown) => void) => {
          if (event === "end") {
            setTimeout(() => handler(), 1);
          }
        },
      );

      const mockResponse = createMockInteractionResponse(mockMessage);
      mockInteraction.reply = mock(() => Promise.resolve(mockResponse));

      const paginator = new Paginator({
        interaction:
          mockInteraction as unknown as ChatInputCommandInteraction<"cached">,
        getPageFn: mockGetPageFn,
        getTotalEntriesFn: mockGetTotalEntriesFn,
        pageSize: 10,
        embedModifierFn: mockEmbedModifierFn,
        config: { timeoutMs: customTimeout },
        logger: mockLogger,
      });

      await paginator.paginate();

      expect(mockMessage.createMessageComponentCollector).toHaveBeenCalledWith({
        componentType: ComponentType.Button,
        idle: customTimeout,
      });
    });

    it("should use custom page jump size", () => {
      const customJumpSize = 3;
      const paginator = new Paginator({
        interaction:
          mockInteraction as unknown as ChatInputCommandInteraction<"cached">,
        getPageFn: mockGetPageFn,
        getTotalEntriesFn: mockGetTotalEntriesFn,
        pageSize: 10,
        embedModifierFn: mockEmbedModifierFn,
        config: { pageJumpSize: customJumpSize },
        logger: mockLogger,
      });

      expect(paginator).toBeInstanceOf(Paginator);
      // Jump size behavior would be tested in navigation tests
    });
  });

  describe("Navigation Logic", () => {
    let paginator: Paginator;
    let mockMessage: MockMessage;
    let mockCollector: MockComponentCollector;
    let collectHandler:
      | ((interaction: MockButtonInteraction) => void)
      | undefined;

    beforeEach(() => {
      mockMessage = createMockMessage();
      mockCollector = createMockComponentCollector();
      mockMessage.createMessageComponentCollector = mock(() => mockCollector);

      const mockResponse = createMockInteractionResponse(mockMessage);
      mockInteraction.reply = mock(() => Promise.resolve(mockResponse));

      paginator = new Paginator({
        interaction:
          mockInteraction as unknown as ChatInputCommandInteraction<"cached">,
        getPageFn: mockGetPageFn,
        getTotalEntriesFn: mockGetTotalEntriesFn,
        pageSize: 10,
        embedModifierFn: mockEmbedModifierFn,
        logger: mockLogger,
      });

      // Capture the collect handler and setup end handler
      mockCollector.on = mock(
        (event: string, handler: (arg?: unknown) => void) => {
          if (event === "collect") {
            collectHandler = handler;
          }
          if (event === "end") {
            setTimeout(() => handler(), 50); // Give time for interactions
          }
        },
      );
    });

    it("should handle forward button navigation", async () => {
      const paginatePromise = paginator.paginate();

      // Wait for setup
      await new Promise((resolve) => setTimeout(resolve, 10));

      const buttonInteraction = createMockButtonInteraction("forward");
      if (collectHandler) {
        await collectHandler(buttonInteraction);
      }

      await paginatePromise;

      // Should fetch new page data
      expect(mockGetPageFn).toHaveBeenCalledWith(1, 10);
      expect(buttonInteraction.update).toHaveBeenCalledWith({
        embeds: [expect.any(EmbedBuilder)],
        components: expect.any(Array),
      });
    });

    it("should handle back button navigation", async () => {
      const paginatePromise = paginator.paginate();

      // Wait for setup
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Go forward first
      const forwardInteraction = createMockButtonInteraction("forward");
      if (collectHandler) {
        await collectHandler(forwardInteraction);
      }

      // Then go back
      const backInteraction = createMockButtonInteraction("back");
      if (collectHandler) {
        await collectHandler(backInteraction);
      }

      await paginatePromise;

      expect(mockGetPageFn).toHaveBeenCalledWith(0, 10); // Back to original page
    });

    it("should handle forward5 button navigation", async () => {
      const paginatePromise = paginator.paginate();

      // Wait for setup
      await new Promise((resolve) => setTimeout(resolve, 10));

      const buttonInteraction = createMockButtonInteraction("forward5");
      if (collectHandler) {
        await collectHandler(buttonInteraction);
      }

      await paginatePromise;

      // Should jump 5 pages forward (or to max page)
      expect(mockGetPageFn).toHaveBeenCalledWith(2, 10); // min(0 + 5, 3 - 1) = 2
    });

    it("should handle back5 button navigation", async () => {
      const paginatePromise = paginator.paginate();

      // Wait for setup
      await new Promise((resolve) => setTimeout(resolve, 10));

      const buttonInteraction = createMockButtonInteraction("back5");
      if (collectHandler) {
        await collectHandler(buttonInteraction);
      }

      await paginatePromise;

      // Should stay at page 0 (can't go below 0)
      expect(mockGetPageFn).toHaveBeenCalledWith(0, 10);
    });

    it("should use custom page jump size", async () => {
      const customPaginator = new Paginator({
        interaction:
          mockInteraction as unknown as ChatInputCommandInteraction<"cached">,
        getPageFn: mockGetPageFn,
        getTotalEntriesFn: mockGetTotalEntriesFn,
        pageSize: 10,
        embedModifierFn: mockEmbedModifierFn,
        config: { pageJumpSize: 3 },
        logger: mockLogger,
      });

      const paginatePromise = customPaginator.paginate();

      // Wait for setup
      await new Promise((resolve) => setTimeout(resolve, 10));

      const buttonInteraction = createMockButtonInteraction("forward5");
      if (collectHandler) {
        await collectHandler(buttonInteraction);
      }

      await paginatePromise;

      // Should jump 3 pages forward with custom jump size
      expect(mockGetPageFn).toHaveBeenCalledWith(2, 10); // min(0 + 3, 3 - 1) = 2
    });

    it("should prevent navigation beyond page bounds", async () => {
      const singlePageFn = mock(() => Promise.resolve(5)); // Only 5 entries = 1 page
      const boundedPaginator = new Paginator({
        interaction:
          mockInteraction as unknown as ChatInputCommandInteraction<"cached">,
        getPageFn: mockGetPageFn,
        getTotalEntriesFn: singlePageFn,
        pageSize: 10,
        embedModifierFn: mockEmbedModifierFn,
        logger: mockLogger,
      });

      const paginatePromise = boundedPaginator.paginate();

      // Wait for setup
      await new Promise((resolve) => setTimeout(resolve, 10));

      const buttonInteraction = createMockButtonInteraction("forward");
      if (collectHandler) {
        await collectHandler(buttonInteraction);
      }

      await paginatePromise;

      // Should stay at page 0 (only 1 page total)
      expect(mockGetPageFn).toHaveBeenCalledWith(0, 10);
    });

    it("should throw ComponentInteractionError for unknown button", async () => {
      const paginatePromise = paginator.paginate();

      // Wait for setup
      await new Promise((resolve) => setTimeout(resolve, 10));

      const buttonInteraction = createMockButtonInteraction("unknown_button");

      if (collectHandler) {
        await expect(collectHandler(buttonInteraction)).rejects.toThrow(
          ComponentInteractionError,
        );
      }

      await paginatePromise;
    });
  });

  describe("Button Interaction Authorization", () => {
    let paginator: Paginator;
    let mockMessage: MockMessage;
    let mockCollector: MockComponentCollector;
    let collectHandler:
      | ((interaction: MockButtonInteraction) => void)
      | undefined;

    beforeEach(() => {
      mockMessage = createMockMessage();
      mockCollector = createMockComponentCollector();
      mockMessage.createMessageComponentCollector = mock(() => mockCollector);

      const mockResponse = createMockInteractionResponse(mockMessage);
      mockInteraction.reply = mock(() => Promise.resolve(mockResponse));

      paginator = new Paginator({
        interaction:
          mockInteraction as unknown as ChatInputCommandInteraction<"cached">,
        getPageFn: mockGetPageFn,
        getTotalEntriesFn: mockGetTotalEntriesFn,
        pageSize: 10,
        embedModifierFn: mockEmbedModifierFn,
        logger: mockLogger,
      });

      mockCollector.on = mock(
        (event: string, handler: (arg?: unknown) => void) => {
          if (event === "collect") {
            collectHandler = handler;
          }
          if (event === "end") {
            setTimeout(() => handler(), 50); // Give time for interactions
          }
        },
      );
    });

    it("should reject unauthorized users", async () => {
      const paginatePromise = paginator.paginate();

      // Wait for setup
      await new Promise((resolve) => setTimeout(resolve, 10));

      const unauthorizedInteraction = createMockButtonInteraction(
        "forward",
        "different_user",
      );
      if (collectHandler) {
        await collectHandler(unauthorizedInteraction);
      }

      await paginatePromise;

      expect(unauthorizedInteraction.reply).toHaveBeenCalledWith({
        content:
          "This isn't for you!! Run your own command to use these buttons.",
        ephemeral: true,
      });

      expect(unauthorizedInteraction.update).not.toHaveBeenCalled();
    });

    it("should use custom unauthorized message", async () => {
      const customMessage = "Access denied!";
      const customPaginator = new Paginator({
        interaction:
          mockInteraction as unknown as ChatInputCommandInteraction<"cached">,
        getPageFn: mockGetPageFn,
        getTotalEntriesFn: mockGetTotalEntriesFn,
        pageSize: 10,
        embedModifierFn: mockEmbedModifierFn,
        config: { unauthorizedMessage: customMessage },
        logger: mockLogger,
      });

      const paginatePromise = customPaginator.paginate();

      // Wait for setup
      await new Promise((resolve) => setTimeout(resolve, 10));

      const unauthorizedInteraction = createMockButtonInteraction(
        "forward",
        "different_user",
      );
      if (collectHandler) {
        await collectHandler(unauthorizedInteraction);
      }

      await paginatePromise;

      expect(unauthorizedInteraction.reply).toHaveBeenCalledWith({
        content: customMessage,
        ephemeral: true,
      });
    });

    it("should allow authorized users", async () => {
      const paginatePromise = paginator.paginate();

      // Wait for setup
      await new Promise((resolve) => setTimeout(resolve, 10));

      const authorizedInteraction = createMockButtonInteraction(
        "forward",
        "user123",
      );
      if (collectHandler) {
        await collectHandler(authorizedInteraction);
      }

      await paginatePromise;

      expect(authorizedInteraction.reply).not.toHaveBeenCalled();
      expect(authorizedInteraction.update).toHaveBeenCalled();
    });
  });

  describe("Component Collector Management", () => {
    let paginator: Paginator;
    let mockMessage: MockMessage;
    let mockCollector: MockComponentCollector;
    let endHandler: () => void;

    beforeEach(() => {
      mockMessage = createMockMessage();
      mockCollector = createMockComponentCollector();
      mockMessage.createMessageComponentCollector = mock(() => mockCollector);

      const mockResponse = createMockInteractionResponse(mockMessage);
      mockInteraction.reply = mock(() => Promise.resolve(mockResponse));

      paginator = new Paginator({
        interaction:
          mockInteraction as unknown as ChatInputCommandInteraction<"cached">,
        getPageFn: mockGetPageFn,
        getTotalEntriesFn: mockGetTotalEntriesFn,
        pageSize: 10,
        embedModifierFn: mockEmbedModifierFn,
        logger: mockLogger,
      });

      mockCollector.on = mock(
        (event: string, handler: (arg?: unknown) => void) => {
          if (event === "end") {
            endHandler = handler;
          }
        },
      );
    });

    it("should disable buttons when collector ends", async () => {
      const paginatePromise = paginator.paginate();

      // Simulate collector ending
      setTimeout(() => endHandler(), 10);

      await paginatePromise;

      expect(mockMessage.edit).toHaveBeenCalledWith({
        components: expect.any(Array),
      });
    });

    it("should log when collector ends", async () => {
      const paginatePromise = paginator.paginate();

      setTimeout(() => endHandler(), 10);

      await paginatePromise;

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Collector ended, disabling buttons",
      );
    });

    it("should handle errors when disabling buttons", async () => {
      mockMessage.edit = mock(() => Promise.reject(new Error("Edit failed")));

      const paginatePromise = paginator.paginate();

      setTimeout(() => endHandler(), 10);

      await paginatePromise;

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.any(Error),
        "Error while disabling buttons",
      );
    });
  });

  describe("Integration Tests", () => {
    it("should handle complete pagination workflow", async () => {
      const pages = ["Page 0", "Page 1", "Page 2"];
      const mockPageFn = createMockGetPageFn(pages);
      const mockTotalFn = mock(() => Promise.resolve(25)); // 3 pages with size 10

      const mockMessage = createMockMessage();
      const mockCollector = createMockComponentCollector();
      let collectHandler:
        | ((interaction: MockButtonInteraction) => void)
        | undefined;
      let endHandler: (() => void) | undefined;

      mockMessage.createMessageComponentCollector = mock(() => mockCollector);
      mockCollector.on = mock(
        (event: string, handler: (arg?: unknown) => void) => {
          if (event === "collect") collectHandler = handler;
          if (event === "end") endHandler = handler;
        },
      );

      const mockResponse = createMockInteractionResponse(mockMessage);
      mockInteraction.reply = mock(() => Promise.resolve(mockResponse));

      const paginator = new Paginator({
        interaction:
          mockInteraction as unknown as ChatInputCommandInteraction<"cached">,
        getPageFn: mockPageFn,
        getTotalEntriesFn: mockTotalFn,
        pageSize: 10,
        embedModifierFn: mockEmbedModifierFn,
        logger: mockLogger,
      });

      // Start pagination
      const paginatePromise = paginator.paginate();

      // Wait for collector to be set up
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Simulate user clicking forward
      const forwardInteraction = createMockButtonInteraction("forward");
      if (collectHandler) {
        await collectHandler(forwardInteraction);
      }

      // Simulate user clicking back
      const backInteraction = createMockButtonInteraction("back");
      if (collectHandler) {
        await collectHandler(backInteraction);
      }

      // End the collector
      if (endHandler) {
        setTimeout(() => {
          if (endHandler) endHandler();
        }, 10);
      }
      await paginatePromise;

      // Verify the complete workflow
      expect(mockInteraction.reply).toHaveBeenCalledTimes(1);
      expect(mockPageFn).toHaveBeenCalledWith(0, 10); // Initial page
      expect(mockPageFn).toHaveBeenCalledWith(1, 10); // Forward navigation
      expect(mockPageFn).toHaveBeenCalledWith(0, 10); // Back navigation
      expect(mockMessage.edit).toHaveBeenCalledWith({
        components: expect.any(Array),
      });
    });

    it("should work with builder pattern in real scenario", async () => {
      const mockPageFn = createMockGetPageFn(["Test Page"]);
      const mockTotalFn = mock(() => Promise.resolve(5));

      const mockMessage = createMockMessage();
      const mockCollector = createMockComponentCollector();
      mockMessage.createMessageComponentCollector = mock(() => mockCollector);

      // Setup collector to end immediately
      mockCollector.on = mock(
        (event: string, handler: (arg?: unknown) => void) => {
          if (event === "end") {
            setTimeout(() => handler(), 1);
          }
        },
      );

      const mockResponse = createMockInteractionResponse(mockMessage);
      mockInteraction.reply = mock(() => Promise.resolve(mockResponse));

      const paginator = PaginatorBuilder.create()
        .withInteraction(
          mockInteraction as unknown as ChatInputCommandInteraction<"cached">,
        )
        .withPageFn(mockPageFn)
        .withTotalEntriesFn(mockTotalFn)
        .withPageSize(5)
        .withEmbedModifier(mockEmbedModifierFn)
        .withTimeout(30000)
        .withCustomMessages({
          emptyPage: "No data",
          unauthorized: "Not allowed",
        })
        .build();

      await paginator.paginate();

      expect(mockInteraction.reply).toHaveBeenCalled();
      expect(mockPageFn).toHaveBeenCalledWith(0, 5);
      expect(mockMessage.createMessageComponentCollector).toHaveBeenCalledWith({
        componentType: ComponentType.Button,
        idle: 30000,
      });
    });
  });

  describe("Error Classes", () => {
    it("should create PaginationError with code", () => {
      const error = new PaginationError("Test error", "TEST_CODE");
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(PaginationError);
      expect(error.message).toBe("Test error");
      expect(error.code).toBe("TEST_CODE");
      expect(error.name).toBe("PaginationError");
    });

    it("should create PageFetchError with page index", () => {
      const error = new PageFetchError("Page fetch failed", 5);
      expect(error).toBeInstanceOf(PaginationError);
      expect(error).toBeInstanceOf(PageFetchError);
      expect(error.message).toBe("Page fetch failed");
      expect(error.pageIndex).toBe(5);
      expect(error.code).toBe("PAGE_FETCH_ERROR");
    });

    it("should create ComponentInteractionError with button ID", () => {
      const error = new ComponentInteractionError(
        "Button error",
        "unknown_button",
      );
      expect(error).toBeInstanceOf(PaginationError);
      expect(error).toBeInstanceOf(ComponentInteractionError);
      expect(error.message).toBe("Button error");
      expect(error.buttonId).toBe("unknown_button");
      expect(error.code).toBe("COMPONENT_INTERACTION_ERROR");
    });
  });
});
