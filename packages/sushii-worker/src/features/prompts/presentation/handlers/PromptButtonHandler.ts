import type {
  AnySelectMenuInteraction,
  ButtonInteraction,
  MessageComponentInteraction,
} from "discord.js";

import {
  ButtonHandler,
  SelectMenuHandler,
} from "@/shared/presentation/handlers";

import type { PromptService } from "../../application/PromptService";
import { parseCustomId } from "../customIds";
import {
  buildDismissedMessage,
  buildNotAllowedMessage,
  buildSnoozedMessage,
} from "../views/buildPromptMessage";

function matchPrompt(service: PromptService) {
  return (customId: string) => {
    const parsed = parseCustomId(customId);
    if (!parsed || !service.getPrompt(parsed.promptId)) {
      return false;
    }
    return { path: customId, index: 0, params: {} };
  };
}

async function handlePromptComponent(
  service: PromptService,
  interaction: MessageComponentInteraction,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    throw new Error("Not a guild interaction");
  }
  const parsed = parseCustomId(interaction.customId);
  const prompt = parsed ? service.getPrompt(parsed.promptId) : undefined;
  if (!parsed || !prompt) {
    return;
  }

  if (prompt.canAct && !prompt.canAct(interaction)) {
    await interaction.reply(buildNotAllowedMessage());
    return;
  }

  const ctx = service.actionContext(prompt, interaction);
  service.recordAction(prompt.id, parsed.action);

  if (parsed.action === "snooze") {
    await service.recordSnoozed(prompt, ctx.subject);
    await interaction.update(buildSnoozedMessage(service.snoozeDays(prompt)));
    return;
  }
  if (parsed.action === "dismiss") {
    await service.recordDismissed(prompt, ctx.subject);
    await interaction.update(buildDismissedMessage());
    return;
  }
  if (!prompt.handleAction) {
    throw new Error("Prompt has no handler for this action", {
      cause: { promptId: prompt.id, action: parsed.action },
    });
  }
  await prompt.handleAction(interaction, parsed.action, ctx);
}

export class PromptButtonHandler extends ButtonHandler {
  readonly customIDMatch: ButtonHandler["customIDMatch"];

  constructor(private readonly promptService: PromptService) {
    super();
    this.customIDMatch = matchPrompt(promptService);
  }

  async handleInteraction(interaction: ButtonInteraction): Promise<void> {
    await handlePromptComponent(this.promptService, interaction);
  }
}

export class PromptSelectMenuHandler extends SelectMenuHandler {
  readonly customIDMatch: ButtonHandler["customIDMatch"];

  constructor(private readonly promptService: PromptService) {
    super();
    this.customIDMatch = matchPrompt(promptService);
  }

  async handleInteraction(
    interaction: AnySelectMenuInteraction,
  ): Promise<void> {
    await handlePromptComponent(this.promptService, interaction);
  }
}
