import { metrics } from "@opentelemetry/api";
import { InteractionType } from "discord.js";
import type { Interaction } from "discord.js";
import { ApplicationCommandType } from "discord.js";

import logger from "@/shared/infrastructure/logger";

import { prefixedName } from "./feature";

const meter = metrics.getMeter("interactions", "1.0");

// -----------------------------------------------------------------------------
// Interactions
const slashCommandsCounter = meter.createCounter(
  prefixedName("slash_command"),
  {
    description: "Slash commands",
  },
);

const userCommandsCounter = meter.createCounter(prefixedName("user_command"), {
  description: "User commands",
});

const messageCommandsCounter = meter.createCounter(
  prefixedName("message_command"),
  {
    description: "Message commands",
  },
);

const autocompleteCounter = meter.createCounter(
  prefixedName("autocomplete_interaction"),
  {
    description: "Autocomplete interactions",
  },
);

const messageComponentCounter = meter.createCounter(
  prefixedName("message_component_interaction"),
  {
    description: "Message component interactions, e.g. buttons",
  },
);

const modalCounter = meter.createCounter(prefixedName("modal_interaction"), {
  description: "Modal submit interactions",
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
