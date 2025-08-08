import type {
  ButtonComponent,
  ButtonInteraction,
  StringSelectMenuComponent} from "discord.js";
import {
  ComponentType
} from "discord.js";

import customIds from "../customIds";

interface MenuRoleData {
  roleId: string;
  label: string;
}

export function getRoleMenuRequiredRole(
  msg: ButtonInteraction["message"],
): string | null {
  if (!msg.embeds) {
    return null;
  }

  const embed = msg.embeds.at(0);
  if (!embed) {
    return null;
  }

  const roleMention = embed.fields?.find(
    (field) => field.name === "Required role",
  )?.value;

  if (!roleMention) {
    return null;
  }

  const match = roleMention.match(/<@&(\d+)>/);
  if (!match) {
    return null;
  }

  return match[1];
}

export function getRoleMenuMaxRoles(
  msg: ButtonInteraction["message"],
): number | null {
  if (!msg.embeds) {
    return null;
  }

  const embed = msg.embeds.at(0);
  if (!embed) {
    return null;
  }

  const maxRoles = embed.fields?.find(
    (field) => field.name === "Maximum roles you can pick",
  )?.value;
  if (!maxRoles) {
    return null;
  }

  // NaN if invalid, which is falsy
  return parseInt(maxRoles, 10) || null;
}

/**
 * Parse a message to get all the roles contained in buttons.
 */
export function getRoleMenuMessageButtonRoles(
  msg: ButtonInteraction["message"],
): MenuRoleData[] {
  if (!msg.components) {
    return [];
  }

  return msg.components
    .map((row) => {
      if (row.type !== ComponentType.ActionRow) {
        return [];
      }

      return row.components
        .filter(
          (component): component is ButtonComponent =>
            component.type === ComponentType.Button,
        )
        .map((button) => {
          if (!button.customId) {
            throw new Error(
              `Button with label "${button.label}" has no custom ID`,
            );
          }

          if (!button.customId) {
            return {
              roleId: null,
              label: button.label,
            };
          }

          const match = customIds.roleMenuButton.matchParams(button.customId);

          return {
            roleId: match ? match.roleId : null,
            label: button.label,
          };
        })
        .filter((button): button is MenuRoleData => !!button.roleId);
    })
    .flat();
}

export function getRoleMenuMessageSelectRoles(
  msg: ButtonInteraction["message"],
): MenuRoleData[] {
  if (!msg.components) {
    return [];
  }

  return msg.components
    .map((row) => {
      if (row.type !== ComponentType.ActionRow) {
        return [];
      }

      return row.components
        .filter(
          (component): component is StringSelectMenuComponent =>
            component.type === ComponentType.StringSelect,
        )
        .flatMap((selectMenu) =>
          selectMenu.options.map((option) => ({
            roleId: option.value,
            label: option.label,
          })),
        )
        .filter((option): option is MenuRoleData => !!option.roleId);
    })
    .flat();
}
