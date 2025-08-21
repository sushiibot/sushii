import type {
  EventHandler,
  EventType,
} from "@/core/cluster/presentation/EventHandler";
import type {
  AutocompleteHandler,
  ButtonHandler,
  SlashCommandHandler,
} from "@/shared/presentation/handlers";
import type ContextMenuHandler from "@/shared/presentation/handlers/ContextMenuHandler";
import type { AbstractBackgroundTask } from "@/shared/infrastructure/tasks/AbstractBackgroundTask";

/**
 * Type aliases for handler collections
 */
export type Commands = SlashCommandHandler[];
export type Autocompletes = AutocompleteHandler[];
export type ContextMenuHandlers = ContextMenuHandler[];
export type ButtonHandlers = ButtonHandler[];

// Allow arrays of event handlers for any specific event type including raw events
export type EventHandlers = {
  [K in EventType]: EventHandler<K>;
}[EventType][];
export type Tasks = AbstractBackgroundTask[];

/**
 * Base interface that all feature setup functions should extend
 */
export interface BaseFeatureSetupReturn {
  /** Slash command handlers */
  commands: Commands;
  /** Autocomplete handlers */
  autocompletes: Autocompletes;
  /** Context menu handlers */
  contextMenuHandlers: ContextMenuHandlers;
  /** Button handlers */
  buttonHandlers: ButtonHandlers;
  /** Event handlers */
  eventHandlers: EventHandlers;
}

/**
 * Extended interface for features that include background tasks
 */
export interface FeatureSetupWithTasks extends BaseFeatureSetupReturn {
  /** Background tasks */
  tasks: Tasks;
}

/**
 * Generic interface for features with services
 * @template TServices - The type of the services object
 */
export interface FeatureSetupWithServices<TServices = unknown>
  extends BaseFeatureSetupReturn {
  /** Feature-specific services */
  services: TServices;
}

/**
 * Full interface for features with both services and tasks
 * @template TServices - The type of the services object
 */
export interface FullFeatureSetupReturn<TServices = unknown>
  extends FeatureSetupWithServices<TServices> {
  /** Background tasks */
  tasks: Tasks;
}

/**
 * Utility type to make all properties optional except specified ones
 * This allows features to only return what they actually provide
 */
export type PartialFeatureSetup<T extends BaseFeatureSetupReturn> = {
  [K in keyof T]?: T[K];
} & Pick<T, never>; // This ensures the base structure is maintained

/**
 * Minimal feature setup - only requires what the feature actually provides
 */
export interface MinimalFeatureSetup {
  commands?: Commands;
  autocompletes?: Autocompletes;
  contextMenuHandlers?: ContextMenuHandlers;
  buttonHandlers?: ButtonHandlers;
  eventHandlers?: EventHandlers;
  tasks?: Tasks;
  services?: unknown;
}
