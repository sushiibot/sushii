import type InteractionClient from "@/core/cluster/discord/InteractionRouter";

import RoleMenuCommand from "./roles/RoleMenu";
import RoleMenuAutocomplete from "./roles/RoleMenuAutocomplete";
import RoleMenuButtonHandler from "./roles/RoleMenuButtonHandler";
import RoleMenuSelectMenuHandler from "./roles/RoleMenuSelectMenuHandler";

export default function registerLegacyInteractionHandlers(
  interactionRouter: InteractionClient,
): void {
  interactionRouter.addCommands(
    new RoleMenuCommand(),
  );

  // ----------------------------------------
  // Autocomplete
  interactionRouter.addAutocompleteHandlers(
    new RoleMenuAutocomplete(),
  );

  // ----------------------------------------
  // Buttons
  interactionRouter.addButtons(new RoleMenuButtonHandler());

  // ----------------------------------------
  // Select menus
  interactionRouter.addSelectMenus(new RoleMenuSelectMenuHandler());
}
