import type { CacheType, ContainerBuilder, Interaction } from "discord.js";
import { SeparatorBuilder, TextDisplayBuilder } from "discord.js";

import type { SettingsMessageOptions } from "../components/SettingsConstants";

interface OtherCommand {
  name: string;
  command: string;
  description: string;
}

const OTHER_COMMANDS: readonly OtherCommand[] = [
  {
    name: "Level Roles",
    command: "/levelrole",
    description: "Auto-assign roles to members as they level up.",
  },
  {
    name: "Role Menus",
    command: "/rolemenu",
    description: "Let members self-assign roles via buttons or reactions.",
  },
  {
    name: "Schedule",
    command: "/schedule-config",
    description: "Sync a Google Calendar to a Discord channel.",
  },
  {
    name: "Tags",
    command: "/tag-admin",
    description: "Manage custom tag responses for this server.",
  },
];

/** Plain read-only list — these features are configured entirely in their own commands. */
export function addMoreContent(
  container: ContainerBuilder,
  _options: SettingsMessageOptions,
  _interaction?: Interaction<CacheType>,
): void {
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "## More Settings\n-# These live in their own commands, not `/settings`.",
    ),
  );

  OTHER_COMMANDS.forEach((entry, index) => {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${entry.name} — \`${entry.command}\`\n${entry.description}`,
      ),
    );

    if (index < OTHER_COMMANDS.length - 1) {
      container.addSeparatorComponents(new SeparatorBuilder());
    }
  });
}
