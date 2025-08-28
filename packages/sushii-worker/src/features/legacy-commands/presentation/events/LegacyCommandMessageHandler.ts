import type { Message } from "discord.js";
import { Events } from "discord.js";
import type { Client } from "discord.js";
import type { Logger } from "pino";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type {
  LegacyCommandDetectionService,
  LegacyCommandNotificationService,
} from "../../application";
import type { LegacyCommand } from "../../domain";
import {
  BOT_RESPONSE_TIMEOUT_MS,
  KNOWN_TAG_SUBCOMMANDS,
  MAX_PENDING_COMMANDS,
  PENDING_COMMANDS_CLEANUP_INTERVAL_MS,
} from "../../domain";
import type { LegacyCommandMetrics } from "../../infrastructure/metrics/LegacyCommandMetrics";
import { buildLegacyCommandDmMessage } from "../views";

interface PendingCommand {
  legacyCommand: LegacyCommand;
  user: Message["author"];
  channelId: string;
  timestamp: number;
}

export class LegacyCommandMessageHandler extends EventHandler<Events.MessageCreate> {
  public readonly eventType = Events.MessageCreate;
  private pendingCommands = new Map<string, PendingCommand>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly client: Client,
    private readonly detectionService: LegacyCommandDetectionService,
    private readonly notificationService: LegacyCommandNotificationService,
    private readonly metrics: LegacyCommandMetrics,
    private readonly logger: Logger,
  ) {
    super();

    // Start periodic cleanup
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldPendingCommands();
    }, PENDING_COMMANDS_CLEANUP_INTERVAL_MS);
  }

  // Cleanup method for graceful shutdown
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.pendingCommands.clear();
  }

  async handle(message: Message): Promise<void> {
    // Only process guild messages
    if (!message.inGuild()) {
      return;
    }

    // Check if this is a bot message - could be sushii responding to a command
    if (message.author.bot) {
      await this.handleBotResponse(message);
      return;
    }

    // Skip if user is a bot
    if (message.author.bot) {
      return;
    }

    try {
      const legacyCommand = await this.detectionService.detectLegacyCommand(
        message.content,
        message.guildId,
      );

      if (!legacyCommand) {
        return;
      }

      this.logger.debug(
        {
          userId: message.author.id,
          guildId: message.guildId,
          command: legacyCommand.name,
        },
        "Detected potential legacy command usage",
      );

      // Store the pending command and wait for bot response
      const pendingKey = `${message.channelId}-${message.author.id}`;

      // Check size limit and evict oldest if necessary (FIFO)
      if (this.pendingCommands.size >= MAX_PENDING_COMMANDS) {
        const firstKey = this.pendingCommands.keys().next().value;
        if (firstKey) {
          this.pendingCommands.delete(firstKey);
          this.logger.warn(
            { evictedKey: firstKey, currentSize: this.pendingCommands.size },
            "Pending commands limit reached, evicting oldest",
          );
        }
      }

      this.pendingCommands.set(pendingKey, {
        legacyCommand,
        user: message.author,
        channelId: message.channelId,
        timestamp: Date.now(),
      });

      // Set timeout to clean up pending command
      setTimeout(() => {
        if (this.pendingCommands.has(pendingKey)) {
          this.pendingCommands.delete(pendingKey);
          this.logger.debug(
            {
              userId: message.author.id,
              command: legacyCommand.name,
            },
            "Legacy command detection timeout - no bot response",
          );
        }
      }, BOT_RESPONSE_TIMEOUT_MS);
    } catch (error) {
      this.logger.error(
        { err: error, messageId: message.id },
        "Error in legacy command detection",
      );
    }
  }

  private async handleBotResponse(message: Message): Promise<void> {
    // Check if this is sushii responding
    if (message.author.id !== this.client.user?.id) {
      return;
    }

    // Look for pending commands in this channel
    const channelPendingCommands = Array.from(this.pendingCommands.entries())
      .filter(([, pending]) => pending.channelId === message.channelId)
      .filter(
        ([, pending]) =>
          Date.now() - pending.timestamp < BOT_RESPONSE_TIMEOUT_MS,
      );

    if (channelPendingCommands.length === 0) {
      return;
    }

    // Process each pending command in this channel
    for (const [key, pending] of channelPendingCommands) {
      this.pendingCommands.delete(key);

      try {
        await this.processPendingCommand(pending);
      } catch (error) {
        this.logger.error(
          {
            err: error,
            userId: pending.user.id,
            command: pending.legacyCommand.name,
          },
          "Error processing pending legacy command",
        );
      }
    }
  }

  private async processPendingCommand(pending: PendingCommand): Promise<void> {
    const { legacyCommand, user } = pending;
    const detectionLatency = Date.now() - pending.timestamp;

    this.logger.info(
      {
        userId: user.id,
        command: legacyCommand.name,
        detectionLatency,
        channelId: pending.channelId,
      },
      "Confirmed legacy command usage - bot responded",
    );

    // Record metrics
    this.recordCommandMetric(legacyCommand.name);

    // Check if we should send a notification
    const shouldNotify = await this.notificationService.shouldSendNotification(
      user.id,
    );
    if (!shouldNotify) {
      this.logger.debug(
        { userId: user.id },
        "Skipping notification - rate limited",
      );
      return;
    }

    // Build and send DM
    const dmMessage = buildLegacyCommandDmMessage(legacyCommand);
    const dmSent = await this.notificationService.sendLegacyCommandDm(
      user,
      legacyCommand,
      dmMessage,
    );

    if (dmSent) {
      // Record the notification
      await this.notificationService.recordNotification(user.id);

      this.logger.info(
        {
          userId: user.id,
          command: legacyCommand.name,
          detectionLatency,
          channelId: pending.channelId,
          notificationSent: true,
        },
        "Legacy command migration DM sent successfully",
      );
    } else {
      this.logger.warn(
        {
          userId: user.id,
          command: legacyCommand.name,
          detectionLatency,
          channelId: pending.channelId,
          notificationSent: false,
        },
        "Failed to send legacy command migration DM",
      );
    }
  }

  private recordCommandMetric(commandName: string): void {
    // Use "tag get" for all direct tag usage to avoid high cardinality
    const isKnownTagSubcommand = KNOWN_TAG_SUBCOMMANDS.includes(commandName);
    const metricLabel =
      commandName.startsWith("tag ") && !isKnownTagSubcommand
        ? "tag get"
        : commandName;

    this.metrics.legacyCommandDetections.add(1, {
      command_name: metricLabel,
    });
  }

  private cleanupOldPendingCommands(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, pending] of this.pendingCommands.entries()) {
      if (now - pending.timestamp > BOT_RESPONSE_TIMEOUT_MS) {
        this.pendingCommands.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(
        {
          cleaned,
          remaining: this.pendingCommands.size,
          cleanupThreshold: BOT_RESPONSE_TIMEOUT_MS,
        },
        "Cleaned up stale pending commands",
      );
    }
  }
}
