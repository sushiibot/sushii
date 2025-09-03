import type { InteractionEditReplyOptions } from "discord.js";
import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from "discord.js";

import Color from "@/utils/colors";

import type { UpdateActiveMenusResult } from "../services/RoleMenuUpdateService";

export function buildRoleMenuUpdateResultMessage(
  result: UpdateActiveMenusResult,
): InteractionEditReplyOptions {
  // Determine color based on results
  let color: number;
  if (result.updatedMenuURLs.length > 0 && result.failed.length === 0) {
    color = Color.Success;
  } else if (result.updatedMenuURLs.length === 0 && result.failed.length > 0) {
    color = Color.Error;
  } else if (result.failed.length > 0) {
    color = Color.Warning;
  } else {
    color = Color.Info;
  }

  const container = new ContainerBuilder().setAccentColor(color);

  let content = "";

  if (result.updatedMenuURLs.length > 0) {
    content += "### ✅ Updated Menus\n";
    content +=
      result.updatedMenuURLs
        .sort()
        .map((url) => `- ${url}`)
        .join("\n") + "\n\n";
  }

  if (result.failed.length > 0) {
    content += "### ❌ Failed to update menus\n";
    content +=
      result.failed
        .sort((a, b) => (a.url > b.url ? 1 : -1))
        .map((menu) => `- ${menu.url} – **${menu.error}**`)
        .join("\n") + "\n\n";
  }

  if (result.noUpdateNeeded.length > 0) {
    content += "### No updates were needed\n";
    content +=
      result.noUpdateNeeded
        .sort()
        .map((url) => `- ${url}`)
        .join("\n") + "\n\n";
  }

  if (
    result.updatedMenuURLs.length === 0 &&
    result.failed.length === 0 &&
    result.noUpdateNeeded.length === 0
  ) {
    content = "No active menus found to update.";
  }

  const text = new TextDisplayBuilder().setContent(content.trim());
  container.addTextDisplayComponents(text);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  };
}
