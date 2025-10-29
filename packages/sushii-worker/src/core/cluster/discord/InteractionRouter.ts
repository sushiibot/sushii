import opentelemetry from "@opentelemetry/api";
import * as Sentry from "@sentry/bun";
import type {
  AnySelectMenuInteraction,
  AutocompleteFocusedOption,
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  ContextMenuCommandInteraction,
  Interaction,
  ModalSubmitInteraction,
  RESTPostAPIApplicationCommandsJSONBody,
} from "discord.js";
import {
  ApplicationCommandType,
  Collection,
  ComponentType,
  InteractionType,
  MessageFlags,
  Routes,
} from "discord.js";
import { t } from "i18next";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { config } from "@/shared/infrastructure/config";
import log from "@/shared/infrastructure/logger";
import type { InteractionMetrics } from "@/shared/infrastructure/metrics/InteractionMetrics";
import type {
  AutocompleteHandler,
  ButtonHandler,
  ModalHandler,
  SelectMenuHandler,
  SlashCommandHandler,
} from "@/shared/presentation/handlers";
import type ContextMenuHandler from "@/shared/presentation/handlers/ContextMenuHandler";
import getFullCommandName from "@/utils/getFullCommandName";
import validationErrorToString from "@/utils/validationErrorToString";

const tracer = opentelemetry.trace.getTracer("interaction-client");

// For JSON.stringify()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function (): string {
  return this.toString();
};

/**
 * Represents a focused option in an autocomplete interaction with its command path
 */
export interface FocusedOption {
  /** The full command path (e.g., "command.subgroup.subcommand") */
  path: string;
  /** The Discord.js focused option data */
  option: AutocompleteFocusedOption;
}

/**
 * Finds the focused option in an autocomplete interaction and builds its command path.
 * Handles nested command structures like command > subcommand group > subcommand.
 *
 * @param interaction - The Discord autocomplete interaction
 * @returns Object containing the command path and focused option, or undefined if none found
 *
 * @example
 * For "/tag get" command with focused "name" option:
 * Returns: { path: "tag.get", option: { name: "name", value: "user_input" } }
 *
 * For "/notification delete" command with focused "type" option:
 * Returns: { path: "notification.delete", option: { name: "type", value: "user_input" } }
 */
export function findFocusedOption(
  interaction: AutocompleteInteraction,
): FocusedOption | undefined {
  const parents = [interaction.commandName];

  const subGroup = interaction.options.getSubcommandGroup();
  if (subGroup) {
    parents.push(subGroup);
  }

  const subCommand = interaction.options.getSubcommand(false);
  if (subCommand) {
    parents.push(subCommand);
  }

  const focusedOption = interaction.options.getFocused(true);

  return {
    path: parents.join("."),
    option: focusedOption,
  };
}

export default class InteractionRouter {
  /**
   * Discord client
   */
  private client: Client;

  /**
   * Deployment service for checking if current deployment is active
   */
  private deploymentService: DeploymentService;

  /**
   * Metrics for recording interaction events
   */
  private interactionMetrics: InteractionMetrics;

  /**
   * Command handlers
   */
  private commands: Collection<string, SlashCommandHandler>;

  /**
   * Autocomplete handlers
   */
  private autocompleteHandlers: Collection<string, AutocompleteHandler>;

  /**
   * Context menu handlers
   */
  private contextMenuHandlers: Collection<string, ContextMenuHandler>;

  /**
   * Modal handlers. This is only for *pure* handlers, if modals require some
   * side effects or logic, they should be handled in the command handler with
   * await modals.
   */
  private modalHandlers: ModalHandler[];

  /**
   * Button handlers
   */
  private buttonHandlers: ButtonHandler[];

  /**
   * select menu handlers
   */
  private selectMenuHandlers: SelectMenuHandler[];

  constructor(
    client: Client,
    deploymentService: DeploymentService,
    interactionMetrics: InteractionMetrics,
  ) {
    this.client = client;
    this.deploymentService = deploymentService;
    this.interactionMetrics = interactionMetrics;
    this.commands = new Collection();
    this.autocompleteHandlers = new Collection();
    this.modalHandlers = [];
    this.buttonHandlers = [];
    this.selectMenuHandlers = [];
    this.contextMenuHandlers = new Collection();
  }

  /**
   * Add multiple commands to register and handle
   *
   * @param commands SlashCommands to add
   */
  public addCommands(...commands: SlashCommandHandler[]): void {
    commands.forEach((c) => this.addCommand(c));
  }

  /**
   * Add a new command to register and handle
   *
   * @param command SlashCommand to add
   */
  public addCommand(command: SlashCommandHandler): void {
    this.commands.set(command.command.name, command);
  }

  /**
   * Add autocomplete handlers with conflict detection
   *
   * @param handlers AutocompleteHandlers to add
   */
  public addAutocompleteHandlers(...handlers: AutocompleteHandler[]): void {
    handlers.forEach((handler) => {
      const paths = handler.getPaths();

      for (const path of paths) {
        const existingHandler = this.autocompleteHandlers.get(path);

        if (existingHandler) {
          // Allow same handler instance to register multiple times (idempotent)
          if (existingHandler === handler) {
            continue;
          }

          // Prevent different handlers from claiming the same path
          throw new Error(
            `Autocomplete path conflict: '${path}' is already registered by ` +
              `${existingHandler.constructor.name}, cannot register ${handler.constructor.name}. ` +
              `Each autocomplete path must be handled by exactly one handler instance.`,
          );
        }

        this.autocompleteHandlers.set(path, handler);

        log.trace(
          {
            path,
            handlerClass: handler.constructor.name,
            totalPaths: paths.length,
          },
          "Registered autocomplete handler",
        );
      }
    });
  }

  /**
   * Add a new context menu handler to register and handle
   *
   * @param command ContextMenuHandler to add
   */
  public addContextMenus(...ctxMenuHandlers: ContextMenuHandler[]): void {
    ctxMenuHandlers.forEach((ctxMenuHandler) => {
      this.contextMenuHandlers.set(ctxMenuHandler.command.name, ctxMenuHandler);
    });
  }

  /**
   * Add a pure modal handler
   *
   * @param modalHandler ModalHandler to add
   */
  public addModalHandlers(...modalHandlers: ModalHandler[]): void {
    this.modalHandlers.push(...modalHandlers);
  }

  /**
   * Add a pure component handler
   *
   * @param buttonHandlers ButtonHandler to add
   */
  public addButtons(...buttonHandlers: ButtonHandler[]): void {
    this.buttonHandlers.push(...buttonHandlers);
  }

  /**
   * Add a pure component handler
   *
   * @param componentHandlers SelectMenuHandlers to add
   */
  public addSelectMenus(...componentHandlers: SelectMenuHandler[]): void {
    this.selectMenuHandlers.push(...componentHandlers);
  }

  /**
   *
   * @returns array of commands to register
   */
  public getCommandsArray(): RESTPostAPIApplicationCommandsJSONBody[] {
    const slashCmds = Array.from(this.commands.values()).map((c) => c.command);
    const contextMenus = Array.from(this.contextMenuHandlers.values()).map(
      (c) => c.command,
    );

    return [...slashCmds, ...contextMenus];
  }

  /**
   * Validate autocomplete handler registrations
   */
  private validateAutocompleteHandlers(): void {
    const registrationMap = new Map<string, string[]>();

    // Group paths by handler class for reporting
    for (const [path, handler] of this.autocompleteHandlers.entries()) {
      const className = handler.constructor.name;
      const existing = registrationMap.get(className) || [];
      existing.push(path);
      registrationMap.set(className, existing);
    }

    log.info(
      {
        totalHandlers: registrationMap.size,
        totalPaths: this.autocompleteHandlers.size,
        registrations: Object.fromEntries(registrationMap),
      },
      "Autocomplete handler validation complete",
    );

    // Validate that each handler has at least one path
    for (const [className, paths] of registrationMap.entries()) {
      if (paths.length === 0) {
        log.warn(
          { className },
          "Autocomplete handler registered with no paths",
        );
      }
    }
  }

  /**
   * Register all slash commands via REST api
   *
   * @returns
   */
  public async register(): Promise<void> {
    // Validate autocomplete handlers before registering commands
    this.validateAutocompleteHandlers();

    log.info("registering %s global commands...", this.commands.size);

    try {
      await this.client.rest.put(
        Routes.applicationCommands(config.discord.applicationId),
        { body: this.getCommandsArray() },
      );

      log.info("commands registered!");
    } catch (err) {
      log.error(err, "error registering commands");
    }
  }

  /**
   * Handle an slash command
   *
   * @param interaction slash command interaction
   * @returns
   */
  private async handleSlashCommandInteraction(
    interaction: ChatInputCommandInteraction,
  ): Promise<boolean> {
    const command = this.commands.get(interaction.commandName);

    if (!command) {
      log.error(`received unknown command: ${interaction.commandName}`);
      return false;
    }

    log.info(
      {
        command: getFullCommandName(interaction),
        guildId: interaction.guildId,
        userId: interaction.user.id,
      },
      "received command",
    );

    try {
      log.info(
        {
          command: getFullCommandName(interaction),
          guildId: interaction.guildId,
          userId: interaction.user.id,
        },
        "running command",
      );

      await command.handler(interaction);
    } catch (e) {
      const invoker = interaction.user;

      // Extract validation error details if available
      const validationError = validationErrorToString(e);

      if (validationError) {
        // Log detailed validation error information using shapeshift's built-in toJSON()
        log.error(
          {
            err: e,
            command: getFullCommandName(interaction),
            guildId: interaction.guildId,
            userId: interaction.user.id,
            validationError,
          },
          "Validation error in command %s",
          interaction.commandName,
        );
      } else {
        log.error(e, "error running command %s", interaction.commandName);
      }

      Sentry.withScope((scope) => {
        scope.addAttachment({
          filename: "interaction.json",
          data: JSON.stringify(interaction, null, 2),
          contentType: "application/json",
        });

        scope.addAttachment({
          filename: "interactionOptions.json",
          data: JSON.stringify(interaction.options, null, 2),
          contentType: "application/json",
        });

        // Add detailed validation error attachment if available
        if (validationError) {
          scope.addAttachment({
            filename: "validationError.json",
            data: JSON.stringify(validationError, null, 2),
            contentType: "application/json",
          });
        }

        Sentry.captureException(e, {
          user: {
            id: invoker.id,
            username: invoker.username,
          },
          tags: {
            type: "command",
            command_name: getFullCommandName(interaction),
          },
          contexts: {
            validationError: {
              value: validationError,
            },
          },
        });
      });
      try {
        if (interaction.deferred) {
          await interaction.editReply(t("generic.error.internal"));
        } else {
          await interaction.reply(t("generic.error.internal"));
        }
      } catch (e2) {
        Sentry.captureException(e2);
        log.warn(e2, "error replying error %s", interaction.commandName);
      }

      // Failure
      return false;
    }

    return true;
  }

  /**
   * Handle an autocomplete interaction
   *
   * @param interaction autocomplete interaction
   * @returns
   */
  private async handleAutocompleteInteraction(
    interaction: AutocompleteInteraction,
  ): Promise<boolean> {
    // Find focused option path, e.g. notification.delete
    const focusedOption = findFocusedOption(interaction);

    if (!focusedOption) {
      log.error(
        {
          commandName: interaction.commandName,
          guildId: interaction.guildId,
          userId: interaction.user.id,
        },
        "No focused option found for autocomplete",
      );

      return false;
    }

    const autocomplete = this.autocompleteHandlers.get(focusedOption.path);

    if (!autocomplete) {
      log.error(
        {
          path: focusedOption.path,
          commandName: interaction.commandName,
          guildId: interaction.guildId,
          userId: interaction.user.id,
          availablePaths: Array.from(this.autocompleteHandlers.keys()),
        },
        "Unknown autocomplete path",
      );

      // Provide empty response to prevent Discord timeout
      try {
        await interaction.respond([]);
      } catch (responseError) {
        log.warn(
          { err: responseError },
          "Failed to send empty autocomplete response",
        );
      }

      return false;
    }

    log.debug(
      {
        path: focusedOption.path,
        option: focusedOption.option,
        guildId: interaction.guildId,
        userId: interaction.user.id,
        handlerClass: autocomplete.constructor.name,
      },
      "Processing autocomplete",
    );

    try {
      await autocomplete.handler(interaction, focusedOption.option);
      return true;
    } catch (err) {
      Sentry.captureException(err, {
        tags: {
          type: "autocomplete",
          path: focusedOption.path,
          handler: autocomplete.constructor.name,
        },
        user: {
          id: interaction.user.id,
          username: interaction.user.username,
        },
        extra: {
          guildId: interaction.guildId,
          optionName: focusedOption.option.name,
          optionValue: focusedOption.option.value,
        },
      });

      log.error(
        {
          err: err,
          path: focusedOption.path,
          handlerClass: autocomplete.constructor.name,
          guildId: interaction.guildId,
          userId: interaction.user.id,
          optionName: focusedOption.option.name,
          optionValue: focusedOption.option.value,
        },
        "Error in autocomplete handler",
      );

      return false;
    }
  }

  /**
   * Handle an application command, this can be a slash command or a context menu interaction
   *
   * @param interaction application interaction
   * @returns
   */
  private async handleContextMenuInteraction(
    interaction: ContextMenuCommandInteraction,
  ): Promise<boolean> {
    const command = this.contextMenuHandlers.get(interaction.commandName);

    if (!command) {
      log.error(`received unknown command: ${interaction.commandName}`);
      return false;
    }

    log.info("received %s command", interaction.commandName);

    try {
      await command.handler(interaction);
    } catch (e) {
      Sentry.captureException(e, {
        tags: {
          type: "context_menu",
          name: interaction.commandName,
        },
      });
      log.error(e, "error running command %s", interaction.commandName);

      try {
        await interaction.reply({
          content: t("generic.error.internal"),
          flags: MessageFlags.Ephemeral,
        });
      } catch (e2) {
        Sentry.captureException(e2);
        log.warn(e2, "error replying error %s", interaction.commandName);
      }

      return false;
    }

    return true;
  }

  /**
   * Handle a pure modal submit interaction
   *
   * @param interaction modal submit interaction
   */
  private async handleModalSubmit(
    interaction: ModalSubmitInteraction,
  ): Promise<boolean> {
    const modalHandler = this.modalHandlers.find(
      (handler) => handler.customIDMatch(interaction.customId) !== false,
    );

    if (!modalHandler) {
      log.error(
        "received unknown modal submit interaction: %s",
        interaction.customId,
      );

      return false;
    }

    log.info("received %s modal submit", interaction.customId);

    try {
      await modalHandler.handleModalSubmit(interaction);
      return true;
    } catch (e) {
      Sentry.captureException(e, {
        tags: {
          type: "modal",
          custom_id: interaction.customId,
        },
      });

      log.error(e, "error handling modal %s: %s", interaction.id);
      return false;
    }
  }

  /**
   * Handle a pure button interaction
   *
   * @param interaction button interaction
   */
  private async handleButtonSubmit(
    interaction: ButtonInteraction,
  ): Promise<boolean> {
    // TODO: button / select menu handlers don't really need to be a collection
    // as we are always iterating through all handlers
    const buttonHandler = this.buttonHandlers.find(
      (handler) => handler.customIDMatch(interaction.customId) !== false,
    );

    if (!buttonHandler) {
      // This can happen if there's just an interaction collector
      log.warn("received unknown button interaction: %s", interaction.customId);

      return false;
    }

    log.info("received %s button", interaction.customId);

    try {
      await buttonHandler.handleInteraction(interaction);
    } catch (err) {
      Sentry.captureException(err, {
        tags: {
          type: "button",
          custom_id: interaction.customId,
          handler: buttonHandler.constructor.name,
        },
      });

      log.error(
        {
          err,
          interactionId: interaction.id,
          handler: buttonHandler.constructor.name,
        },
        "error handling button",
      );

      return false;
    }

    return true;
  }

  /**
   * Handle a pure select menu interaction
   *
   * @param interaction select menu interaction
   */
  private async handleSelectMenuSubmit(
    interaction: AnySelectMenuInteraction,
  ): Promise<boolean> {
    const selectMenuHandler = this.selectMenuHandlers.find(
      (handler) => handler.customIDMatch(interaction.customId) !== false,
    );

    if (!selectMenuHandler) {
      log.error(
        "received unknown select menu interaction: %s",
        interaction.customId,
      );

      return false;
    }

    log.info("received %s select menu", interaction.customId);

    try {
      await selectMenuHandler.handleInteraction(interaction);
      return true;
    } catch (e) {
      Sentry.captureException(e);
      log.error(e, "error handling select menu %s: %o", interaction.id);
      return false;
    }
  }

  public async handleAPIInteraction(interaction: Interaction): Promise<void> {
    // Ignore all interactions that are not from the current deployment
    const active = this.deploymentService.isCurrentDeploymentActive(
      interaction.channelId,
    );
    if (!active) {
      log.info(
        {
          processDeploymentName: config.deployment.name,
          activeDeployment: this.deploymentService.getCurrentDeployment(),
          interactionId: interaction.id,
          channelId: interaction.channelId,
        },
        "Not active deployment, ignoring interaction",
      );

      return;
    }

    await tracer.startActiveSpan("handleAPIInteraction", async (span) => {
      span.setAttribute("interactionType", interaction.type);

      try {
        let success = true;

        switch (interaction.type) {
          case InteractionType.ApplicationCommand: {
            switch (interaction.commandType) {
              case ApplicationCommandType.ChatInput: {
                span.setAttribute("commandName", interaction.commandName);
                success = await this.handleSlashCommandInteraction(interaction);
                break;
              }
              case ApplicationCommandType.Message:
              case ApplicationCommandType.User: {
                span.setAttribute("commandName", interaction.commandName);
                success = await this.handleContextMenuInteraction(interaction);
                break;
              }
            }

            break;
          }
          case InteractionType.ApplicationCommandAutocomplete: {
            span.setAttribute("commandName", interaction.commandName);
            success = await this.handleAutocompleteInteraction(interaction);
            break;
          }

          case InteractionType.MessageComponent: {
            switch (interaction.componentType) {
              case ComponentType.Button: {
                span.setAttribute("customId", interaction.customId);
                success = await this.handleButtonSubmit(interaction);
                break;
              }
              case ComponentType.StringSelect:
              case ComponentType.UserSelect:
              case ComponentType.RoleSelect:
              case ComponentType.MentionableSelect:
              case ComponentType.ChannelSelect: {
                span.setAttribute("customId", interaction.customId);
                success = await this.handleSelectMenuSubmit(interaction);
                break;
              }
            }

            break;
          }

          case InteractionType.ModalSubmit: {
            span.setAttribute("customId", interaction.customId);
            success = await this.handleModalSubmit(interaction);
            break;
          }
        }

        const status = success ? "success" : "error";
        this.interactionMetrics.recordInteraction(interaction, status);

        return undefined;
      } catch (err) {
        log.error(
          err,
          "error handling interaction, should be caught %s",
          interaction.id,
        );
      } finally {
        span.end();
      }
    });
  }
}
