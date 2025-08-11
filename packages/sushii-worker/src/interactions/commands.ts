import type InteractionClient from "@/core/cluster/discord/InteractionRouter";

import StatusCommand from "../features/status/presentation/StatusCommand";
// EmojiStatsCommand migrated to DDD architecture (emoji-stats feature)
import ReminderDeleteAutocomplete from "./reminders/ReminderAutocomplete";
import ReminderCommand from "./reminders/ReminderCommand";
import RoleMenuCommand from "./roles/RoleMenu";
import RoleMenuAutocomplete from "./roles/RoleMenuAutocomplete";
import RoleMenuButtonHandler from "./roles/RoleMenuButtonHandler";
import RoleMenuSelectMenuHandler from "./roles/RoleMenuSelectMenuHandler";

export default function registerLegacyInteractionHandlers(
  interactionRouter: InteractionClient,
): void {
  interactionRouter.addCommands(
    new StatusCommand(),
    new ReminderCommand(),
    new RoleMenuCommand(),
  );

  // ----------------------------------------
  // Autocomplete
  interactionRouter.addAutocompleteHandlers(
    new ReminderDeleteAutocomplete(),
    new RoleMenuAutocomplete(),
  );

  // ----------------------------------------
  // Buttons
  interactionRouter.addButtons(new RoleMenuButtonHandler());

  // ----------------------------------------
  // Select menus
  interactionRouter.addSelectMenus(new RoleMenuSelectMenuHandler());
}
