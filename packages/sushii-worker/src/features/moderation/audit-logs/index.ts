// Legacy compatibility functions
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import { ModLogComponentBuilder } from "@/features/moderation/shared/domain/services/ModLogComponentBuilder";
import type { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";

export * from "./domain";
export * from "./application";
export * from "./presentation";

/**
 * Legacy compatibility function for buildModLogComponents.
 * @deprecated Use ModLogComponentBuilder class directly instead.
 */
export function buildModLogComponents(
  actionType: ActionType,
  modCase: ModerationCase,
  dmDeleted: boolean = false,
) {
  return new ModLogComponentBuilder(actionType, modCase, dmDeleted).build();
}
