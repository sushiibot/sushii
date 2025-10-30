import type { Guild, InteractionReplyOptions } from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  RoleSelectMenuBuilder,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
} from "discord.js";

import Color from "@/utils/colors";

import type { RoleMenu } from "../../domain/entities/RoleMenu";
import type { RoleMenuRole } from "../../domain/entities/RoleMenuRole";
import {
  type BotPermissionsResult,
  ROLE_MENU_BUILDER_CUSTOM_IDS,
  type RoleMenuBuilderState,
} from "./RoleMenuBuilderConstants";

interface ActiveMenuInfo {
  totalCount: number;
  needsUpdateCount: number;
  links: string[];
}

interface RoleMenuBuilderOptions {
  menu: RoleMenu | null;
  roles: RoleMenuRole[];
  guild: Guild;
  state: RoleMenuBuilderState;
  activeMenuInfo?: ActiveMenuInfo;
}

export function createRoleMenuBuilderMessage(
  options: RoleMenuBuilderOptions,
): InteractionReplyOptions & { flags: MessageFlags.IsComponentsV2 } {
  const { menu, roles, guild, state, activeMenuInfo } = options;

  const container = new ContainerBuilder().setAccentColor(Color.Info);

  // Header section with menu configuration
  const headerContent = createHeaderContent(menu, state);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(headerContent),
  );

  // Separator
  container.addSeparatorComponents(new SeparatorBuilder());

  // Roles section
  if (roles.length === 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("**Roles:** None added yet"),
    );
  } else {
    // Sort roles by Discord hierarchy
    const sortedRoles = sortRolesByHierarchy(roles, guild);

    // Pagination setup
    const ROLES_PER_PAGE = 15;
    const currentPage = state.currentPage ?? 0;
    const totalPages = Math.ceil(sortedRoles.length / ROLES_PER_PAGE);
    const startIdx = currentPage * ROLES_PER_PAGE;
    const endIdx = Math.min(startIdx + ROLES_PER_PAGE, sortedRoles.length);
    const pagedRoles = sortedRoles.slice(startIdx, endIdx);

    // Show page info if paginated
    const pageInfo =
      totalPages > 1
        ? ` (Page ${currentPage + 1}/${totalPages})`
        : "";
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**Roles (${roles.length}):**${pageInfo}`),
    );

    // Add section for each role with edit button (only current page)
    for (const [index, role] of pagedRoles.entries()) {
      const roleComponent = createRoleSection(
        role,
        startIdx + index + 1, // Use absolute index for numbering
        state,
      );
      
      // Add appropriate component type based on read-only mode
      if (roleComponent instanceof SectionBuilder) {
        container.addSectionComponents(roleComponent);
      } else {
        container.addTextDisplayComponents(roleComponent);
      }
    }

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# **Note:** Roles are in order of their position in the server.`,
      ),
    );

    // Add pagination buttons if needed
    if (totalPages > 1 && !state.readOnly) {
      const paginationButtons = createPaginationButtons(
        currentPage,
        totalPages,
        state,
      );
      container.addActionRowComponents(paginationButtons);
    }
  }

  // Permission warnings section
  if (state.permissionWarnings) {
    const warningsContent = createPermissionWarningsContent(
      state.permissionWarnings,
    );

    // Has warnings
    if (warningsContent.length > 0) {
      container.addSeparatorComponents(new SeparatorBuilder());
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(warningsContent),
      );
    }
  }

  // Action buttons row (only in edit mode)
  if (!state.readOnly) {
    const actionButtons = createActionButtons(state);
    if (actionButtons.components.length > 0) {
      container.addActionRowComponents(actionButtons);
    }

    // Role select menu row
    const roleSelectMenu = createRoleSelectMenu(roles, state);
    if (roleSelectMenu) {
      container.addActionRowComponents(roleSelectMenu);
    }

    // Required role select menu row
    const requiredRoleSelectMenu = createRequiredRoleSelectMenu(menu, state);
    if (requiredRoleSelectMenu) {
      container.addActionRowComponents(requiredRoleSelectMenu);
    }
  }

  // Finish & Update section for editing with active menus
  if (
    !state.readOnly &&
    state.isEdit &&
    state.activeMenuCount &&
    state.activeMenuCount > 0
  ) {
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `📍 ${state.activeMenuCount} active menus will be updated when you finish`,
      ),
    );

    const finishButton = new ButtonBuilder()
      .setCustomId(ROLE_MENU_BUILDER_CUSTOM_IDS.FINISH_AND_UPDATE)
      .setLabel("Finish & Update Menus 🔄")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(state.disabled);

    const finishButtonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      finishButton,
    );

    container.addActionRowComponents(finishButtonRow);
  }

  // Active menu information (only in read-only mode)
  if (activeMenuInfo && state.readOnly) {
    container.addSeparatorComponents(new SeparatorBuilder());

    const statusText =
      activeMenuInfo.needsUpdateCount === 0
        ? `📍 **Active Menus:** ${activeMenuInfo.totalCount} total`
        : `📍 **Active Menus:** ${activeMenuInfo.totalCount} total (${activeMenuInfo.needsUpdateCount} need updates)`;

    const linksText = activeMenuInfo.links.join("\n");
    const fullContent = `${statusText}\n\n${linksText}`;

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(fullContent),
    );

    // Add update button if there are menus that need updates
    if (activeMenuInfo.needsUpdateCount > 0) {
      const updateButton = new ButtonBuilder()
        .setCustomId(`update_outdated_menus:${state.menuName}`)
        .setLabel("Update Outdated Menus")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🔄");

      const updateButtonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        updateButton,
      );

      container.addActionRowComponents(updateButtonRow);
    }
  }

  // Expiration notice if expired
  if (state.expired) {
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "-# ⏱️ This menu editor has expired. Run `/rolemenu edit` to continue editing.",
      ),
    );
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

function createHeaderContent(
  menu: RoleMenu | null,
  state: RoleMenuBuilderState,
): string {
  const titlePrefix = state.isEdit ? "Editing Role Menu" : "New Role Menu";
  const title = `## 📋 **${titlePrefix}: ${state.menuName}**`;
  const description = `**Description:** ${menu?.description || "Not set"}`;
  const maxRoles = `**Max Roles:** ${menu?.maxCount?.toString() || "No limit"}`;
  const requiredRole = `**Required Role:** ${
    menu?.requiredRole ? `<@&${menu.requiredRole}>` : "None"
  }`;

  return [title, "", description, maxRoles, requiredRole].join("\n");
}

function createPermissionWarningsContent(
  warnings: BotPermissionsResult,
): string {
  if (warnings.canManageRoles && warnings.roleIdsHigherThanBot.length === 0) {
    return "";
  }

  const title = "⚠️ **Bot is missing permissions:**";
  const warningMessages: string[] = [];

  // Handle missing Manage Roles permission
  if (!warnings.canManageRoles) {
    warningMessages.push(
      "- Cannot manage any roles\n> **Please add the `Manage Roles` permission**",
    );
  }

  // Handle hierarchy issues
  if (warnings.roleIdsHigherThanBot.length > 0) {
    const roleMentions = warnings.roleIdsHigherThanBot.map(
      (roleId) => `<@&${roleId}>`,
    );

    const roleList = roleMentions.join(", ");
    warningMessages.push(
      `- Cannot manage ${roleList}\n> **Please move the bot's role higher in Server Settings > Roles**`,
    );
  }

  return [title, ...warningMessages].join("\n");
}

function createRoleSection(
  role: RoleMenuRole,
  index: number,
  state: RoleMenuBuilderState,
): SectionBuilder | TextDisplayBuilder {
  let content = `${index}. <@&${role.roleId}>`;

  if (role.emoji) {
    content += `\n> **Emoji:** ${role.emoji}`;
  }

  if (role.description) {
    content += `\n> **Description:** ${role.description}`;
  }

  // In read-only mode, return TextDisplayBuilder directly to avoid Section validation issues
  if (state.readOnly) {
    return new TextDisplayBuilder().setContent(content);
  }

  // In edit mode, create Section with required button accessory
  const section = new SectionBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(content),
  );

  const editButton = new ButtonBuilder()
    .setCustomId(
      `${ROLE_MENU_BUILDER_CUSTOM_IDS.EDIT_ROLE_OPTIONS}:${role.roleId}`,
    )
    .setLabel("Edit")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(state.disabled);

  section.setButtonAccessory(editButton);

  return section;
}

function sortRolesByHierarchy(
  roles: RoleMenuRole[],
  guild: Guild,
): RoleMenuRole[] {
  return roles.sort((a, b) => {
    const roleA = guild.roles.cache.get(a.roleId);
    const roleB = guild.roles.cache.get(b.roleId);

    // Higher position = higher in hierarchy, so sort descending
    return (roleB?.position ?? 0) - (roleA?.position ?? 0);
  });
}

function createActionButtons(state: RoleMenuBuilderState) {
  const row = new ActionRowBuilder<ButtonBuilder>();

  const editDescriptionButton = new ButtonBuilder()
    .setCustomId(ROLE_MENU_BUILDER_CUSTOM_IDS.EDIT_DESCRIPTION)
    .setLabel("Edit Description")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(state.disabled);

  const setMaxRolesButton = new ButtonBuilder()
    .setCustomId(ROLE_MENU_BUILDER_CUSTOM_IDS.SET_MAX_ROLES)
    .setLabel("Set Max Roles")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(state.disabled);

  row.addComponents(editDescriptionButton, setMaxRolesButton);

  return row;
}

function createRoleSelectMenu(
  roles: RoleMenuRole[],
  state: RoleMenuBuilderState,
) {
  if (state.disabled) {
    return null;
  }

  const selectMenu = new RoleSelectMenuBuilder()
    .setCustomId(ROLE_MENU_BUILDER_CUSTOM_IDS.ROLE_SELECT)
    .setPlaceholder("Add/Remove Roles")
    // Set currently selected roles
    .setDefaultRoles(roles.map((role) => role.roleId))
    .setMinValues(0)
    .setMaxValues(25);

  const row = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    selectMenu,
  );

  return row;
}

function createRequiredRoleSelectMenu(
  menu: RoleMenu | null,
  state: RoleMenuBuilderState,
) {
  if (state.disabled) {
    return null;
  }

  const selectMenu = new RoleSelectMenuBuilder()
    .setCustomId(ROLE_MENU_BUILDER_CUSTOM_IDS.REQUIRED_ROLE_SELECT)
    .setPlaceholder("Set Required Role (Optional)")
    .setMinValues(0)
    .setMaxValues(1);

  // Set currently selected required role
  if (menu?.requiredRole) {
    selectMenu.setDefaultRoles([menu.requiredRole]);
  }

  const row = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    selectMenu,
  );

  return row;
}

function createPaginationButtons(
  currentPage: number,
  totalPages: number,
  state: RoleMenuBuilderState,
) {
  const row = new ActionRowBuilder<ButtonBuilder>();

  const prevButton = new ButtonBuilder()
    .setCustomId(ROLE_MENU_BUILDER_CUSTOM_IDS.PAGE_PREV)
    .setLabel("◀ Previous")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(state.disabled || currentPage === 0);

  const nextButton = new ButtonBuilder()
    .setCustomId(ROLE_MENU_BUILDER_CUSTOM_IDS.PAGE_NEXT)
    .setLabel("Next ▶")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(state.disabled || currentPage >= totalPages - 1);

  row.addComponents(prevButton, nextButton);

  return row;
}
