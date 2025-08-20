import { ValueType, metrics } from "@opentelemetry/api";
import type { Counter } from "@opentelemetry/api";
import { ApplicationCommandType, InteractionType } from "discord.js";
import type { Interaction } from "discord.js";

import { newModuleLogger } from "@/shared/infrastructure/logger";

const logger = newModuleLogger("InteractionMetrics");

export class InteractionMetrics {
  readonly slashCommandCounter: Counter;
  readonly userCommandCounter: Counter;
  readonly messageCommandCounter: Counter;
  readonly autocompleteCounter: Counter;
  readonly messageComponentCounter: Counter;
  readonly modalCounter: Counter;

  constructor() {
    try {
      const meter = metrics.getMeter("interactions", "1.0");

      this.slashCommandCounter = meter.createCounter("slash_command", {
        description: "Slash commands",
        valueType: ValueType.INT,
      });

      this.userCommandCounter = meter.createCounter("user_command", {
        description: "User commands",
        valueType: ValueType.INT,
      });

      this.messageCommandCounter = meter.createCounter("message_command", {
        description: "Message commands",
        valueType: ValueType.INT,
      });

      this.autocompleteCounter = meter.createCounter(
        "autocomplete_interaction",
        {
          description: "Autocomplete interactions",
          valueType: ValueType.INT,
        },
      );

      this.messageComponentCounter = meter.createCounter(
        "message_component_interaction",
        {
          description: "Message component interactions, e.g. buttons",
          valueType: ValueType.INT,
        },
      );

      this.modalCounter = meter.createCounter("modal_interaction", {
        description: "Modal submit interactions",
        valueType: ValueType.INT,
      });

      logger.info("InteractionMetrics initialized successfully");
    } catch (error) {
      logger.error(
        { err: error },
        "Failed to initialize InteractionMetrics - OTEL SDK may not be initialized yet",
      );
      throw error;
    }
  }

  recordInteraction(
    interaction: Interaction,
    status: "success" | "error",
  ): void {
    const { type } = interaction;

    switch (type) {
      case InteractionType.ApplicationCommand: {
        switch (interaction.commandType) {
          case ApplicationCommandType.ChatInput: {
            this.slashCommandCounter.add(1, {
              command_name: interaction.commandName,
              status,
            });
            break;
          }
          case ApplicationCommandType.User: {
            this.userCommandCounter.add(1, {
              command_name: interaction.commandName,
              status,
            });
            break;
          }
          case ApplicationCommandType.Message: {
            this.messageCommandCounter.add(1, {
              command_name: interaction.commandName,
              status,
            });
            break;
          }
        }
        break;
      }
      case InteractionType.ApplicationCommandAutocomplete: {
        this.autocompleteCounter.add(1, {
          command_name: interaction.commandName,
          status,
        });
        break;
      }
      case InteractionType.MessageComponent: {
        // Does not have custom_id since it is high cardinality
        this.messageComponentCounter.add(1, {
          status,
        });
        break;
      }
      case InteractionType.ModalSubmit: {
        this.modalCounter.add(1, {
          status,
        });
        break;
      }
      default: {
        logger.warn("Unhandled interaction type:", type);
      }
    }
  }
}
