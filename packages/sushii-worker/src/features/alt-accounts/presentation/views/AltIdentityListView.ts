import type { ActionRowBuilder, ButtonBuilder } from "discord.js";
import { ContainerBuilder, TextDisplayBuilder } from "discord.js";

import { ComponentsV2Paginator } from "@/shared/presentation/ComponentsV2Paginator";
import Color from "@/utils/colors";

import type { AltIdentitySummary } from "../../domain/types/AltIdentityWithMembers";

function formatIdentityRow(identity: AltIdentitySummary): string {
  const name = identity.nickname ?? `Identity #${identity.id}`;
  const memberWord = identity.memberCount === 1 ? "account" : "accounts";

  return `**${name}** — ${identity.memberCount} ${memberWord}`;
}

export function buildAltIdentityListContainer(
  identities: AltIdentitySummary[],
  navButtons: ActionRowBuilder<ButtonBuilder> | null,
  isDisabled = false,
): ContainerBuilder {
  const container = new ContainerBuilder().setAccentColor(Color.Info);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Tracked Identities"),
  );

  if (identities.length === 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "No tracked identities yet in this server.",
      ),
    );
  } else {
    const rows = identities.map(formatIdentityRow).join("\n");
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(rows));
  }

  ComponentsV2Paginator.addNavigationSection(container, navButtons, isDisabled);

  return container;
}
