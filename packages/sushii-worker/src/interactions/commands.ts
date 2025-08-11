import type InteractionClient from "@/core/cluster/discord/InteractionRouter";

import StatusCommand from "../features/status/presentation/StatusCommand";
// EmojiStatsCommand migrated to DDD architecture (emoji-stats feature)
import ReminderDeleteAutocomplete from "./reminders/ReminderAutocomplete";
import ReminderCommand from "./reminders/ReminderCommand";
import RoleMenuCommand from "./roles/RoleMenu";
import RoleMenuAutocomplete from "./roles/RoleMenuAutocomplete";
import RoleMenuButtonHandler from "./roles/RoleMenuButtonHandler";
import RoleMenuSelectMenuHandler from "./roles/RoleMenuSelectMenuHandler";

export default function registerInteractionHandlers(
  interactionRouter: InteractionClient,
): void {
  interactionRouter.addCommands(
    // Meta
    new StatusCommand(),

    // Guild
    // EmojiStatsCommand migrated to DDD architecture (emoji-stats feature)

    new ReminderCommand(),

    // Roles
    new RoleMenuCommand(),
  );

  // ----------------------------------------
  // Autocomplete
  interactionRouter.addAutocompleteHandlers(
    new ReminderDeleteAutocomplete(),
    new RoleMenuAutocomplete(),
  );

  // ----------------------------------------
  // Context menus
  // Note: Context menus now handled by DDD features in bootstrap

  // ----------------------------------------
  // Buttons
  interactionRouter.addButtons(new RoleMenuButtonHandler());

  // ----------------------------------------
  // Select menus
  interactionRouter.addSelectMenus(new RoleMenuSelectMenuHandler());
}
