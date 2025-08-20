import { ValueType, metrics } from "@opentelemetry/api";
import { InteractionType } from "discord.js";
import type { Interaction } from "discord.js";
import { ApplicationCommandType } from "discord.js";

import logger from "@/shared/infrastructure/logger";

const meter = metrics.getMeter("interactions", "1.0");

// -----------------------------------------------------------------------------
// Interactions
const slashCommandsCounter = meter.createCounter("slash_command", {
  description: "Slash commands",
  valueType: ValueType.INT,
});

const userCommandsCounter = meter.createCounter("user_command", {
  description: "User commands",
  valueType: ValueType.INT,
});

const messageCommandsCounter = meter.createCounter("message_command", {
  description: "Message commands",
  valueType: ValueType.INT,
});

const autocompleteCounter = meter.createCounter("autocomplete_interaction", {
  description: "Autocomplete interactions",
  valueType: ValueType.INT,
});

const messageComponentCounter = meter.createCounter(
  "message_component_interaction",
  {
    description: "Message component interactions, e.g. buttons",
    valueType: ValueType.INT,
  },
);

const modalCounter = meter.createCounter("modal_interaction", {
  description: "Modal submit interactions",
  valueType: ValueType.INT,
});

export function updateInteractionMetrics(
  interaction: Interaction,
  status: "success" | "error",
): void {
  const { type } = interaction;

  switch (type) {
    case InteractionType.ApplicationCommand: {
      switch (interaction.commandType) {
        case ApplicationCommandType.ChatInput: {
          slashCommandsCounter.add(1, {
            command_name: interaction.commandName,
            status,
          });
          break;
        }
        case ApplicationCommandType.User: {
          userCommandsCounter.add(1, {
            command_name: interaction.commandName,
            status,
          });
          break;
        }
        case ApplicationCommandType.Message: {
          messageCommandsCounter.add(1, {
            command_name: interaction.commandName,
            status,
          });
          break;
        }
      }
      break;
    }
    case InteractionType.ApplicationCommandAutocomplete: {
      autocompleteCounter.add(1, {
        command_name: interaction.commandName,
        status,
      });
      break;
    }
    case InteractionType.MessageComponent: {
      // Does not have custom_id since it is high cardinality
      messageComponentCounter.add(1, {
        status,
      });
      break;
    }
    case InteractionType.ModalSubmit: {
      modalCounter.add(1, {
        status,
      });
      break;
    }
    default: {
      logger.warn("Unhandled interaction type:", type);
    }
  }
}
