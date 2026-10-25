import { MessageFlags } from "discord.js";
import type { ButtonInteraction } from "discord.js";
import { match } from "path-to-regexp";

import { ButtonHandler } from "@/shared/presentation/handlers";

import { UserOverviewSession } from "./UserOverviewSession";
import type { UserOverviewDependencies } from "./UserOverviewSession";

export class OpenFishyCollectionButtonHandler extends ButtonHandler {
  readonly customIDMatch = match("fishycollection/open");

  constructor(private readonly dependencies: UserOverviewDependencies) {
    super();
  }

  async handleInteraction(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      await interaction.reply({
        content: "Open your collection with /fishy-collection in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const owner =
      interaction.message.interactionMetadata?.user ?? interaction.user;
    await new UserOverviewSession(
      interaction,
      owner,
      this.dependencies,
      "collection",
    ).start();
  }
}
