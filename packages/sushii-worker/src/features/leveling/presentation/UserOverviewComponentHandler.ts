import { MessageFlags } from "discord.js";
import type { AnySelectMenuInteraction, ButtonInteraction } from "discord.js";
import { match } from "path-to-regexp";

import { ButtonHandler } from "@/shared/presentation/handlers";

import {
  type UserOverviewDependencies,
  UserOverviewSession,
} from "./UserOverviewSession";

/** Shared button/select handler; view state is carried by each control. */
export class UserOverviewComponentHandler extends ButtonHandler {
  readonly customIDMatch = match([
    "fishyview/*state",
    ...["rank", "collection", "previous", "next", "set"].map(
      (action) => `fishycollection\\:${action}`,
    ),
  ]);

  constructor(private readonly dependencies: UserOverviewDependencies) {
    super();
  }

  async handleInteraction(
    interaction: ButtonInteraction | AnySelectMenuInteraction,
  ): Promise<void> {
    if (
      !interaction.inCachedGuild() ||
      interaction.customId.startsWith("fishycollection:")
    ) {
      await interaction.reply({
        content:
          "This older view has expired. Run /fishy-collection or /rank to open a new view.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
      await UserOverviewSession.navigate(interaction, this.dependencies);
    }
  }
}
