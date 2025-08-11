import { InteractionType } from "discord.js";
import type { Interaction } from "discord.js";
import { ApplicationCommandType } from "discord.js";
import { Counter } from "prom-client";

import logger from "@/shared/infrastructure/logger";

import { prefixedName } from "./metrics";

// -----------------------------------------------------------------------------
// Interactions
const slashCommandsCounter = new Counter({
  name: prefixedName("slash_command"),
  help: "Slash commands",
  labelNames: ["command_name", "status"],
});

const userCommandsCounter = new Counter({
  name: prefixedName("user_command"),
  help: "User commands",
  labelNames: ["command_name", "status"],
});

const messageCommandsCounter = new Counter({
  name: prefixedName("message_command"),
  help: "Message commands",
  labelNames: ["command_name", "status"],
});

const autocompleteCounter = new Counter({
  name: prefixedName("autocomplete_interaction"),
  help: "Autocomplete interactions",
  labelNames: ["command_name", "status"],
});

const messageComponentCounter = new Counter({
  name: prefixedName("message_component_interaction"),
  help: "Message component interactions, e.g. buttons",
  labelNames: ["status"],
});

const modalCounter = new Counter({
  name: prefixedName("modal_interaction"),
  help: "Modal submit interactions",
  labelNames: ["status"],
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
          slashCommandsCounter.inc({
            command_name: interaction.commandName,
            status,
          });
          break;
        }
        case ApplicationCommandType.User: {
          userCommandsCounter.inc({
            command_name: interaction.commandName,
            status,
          });
          break;
        }
        case ApplicationCommandType.Message: {
          messageCommandsCounter.inc({
            command_name: interaction.commandName,
            status,
          });
          break;
        }
      }
      break;
    }
    case InteractionType.ApplicationCommandAutocomplete: {
      autocompleteCounter.inc({
        command_name: interaction.commandName,
        status,
      });
      break;
    }
    case InteractionType.MessageComponent: {
      // Does not have custom_id since it is high cardinality
      messageComponentCounter.inc({
        status,
      });
      break;
    }
    case InteractionType.ModalSubmit: {
      modalCounter.inc({
        status,
      });
      break;
    }
    default: {
      logger.warn("Unhandled interaction type:", type);
    }
  }
}
