import { describe, expect, mock, test } from "bun:test";
import type { ButtonInteraction } from "discord.js";
import type { Logger } from "pino";

import { PromptService } from "../../application/PromptService";
import type { PromptDefinition } from "../../domain/PromptDefinition";
import type { PromptStateRepository } from "../../domain/repositories/PromptStateRepository";
import type { PromptMetrics } from "../../infrastructure/PromptMetrics";
import { PromptButtonHandler } from "./PromptButtonHandler";

function setup(canAct: boolean) {
  const repo = {
    recordDismissed: mock(async () => undefined),
  } as unknown as PromptStateRepository & {
    recordDismissed: ReturnType<typeof mock>;
  };
  const prompt = {
    id: "follow",
    scope: "guild",
    repeat: { days: 30 },
    delivery: "auto",
    eligible: async () => true,
    build: () => ({ text: "x" }),
    canAct: () => canAct,
  } as PromptDefinition;
  const metrics = { recordAction: mock() } as unknown as PromptMetrics;
  const service = new PromptService(repo, [prompt], metrics, {} as Logger);
  const interaction = {
    customId: "prompt:follow:dismiss",
    guildId: "200000000000000001",
    user: { id: "100000000000000001" },
    inCachedGuild: () => true,
    reply: mock(async () => undefined),
    update: mock(async () => undefined),
  };
  return { handler: new PromptButtonHandler(service), repo, interaction };
}

describe("PromptButtonHandler", () => {
  test("matches only registered prompts", () => {
    const { handler } = setup(true);
    expect(handler.customIDMatch("prompt:follow:dismiss")).not.toBe(false);
    expect(handler.customIDMatch("prompt:unknown:dismiss")).toBe(false);
    expect(handler.customIDMatch("feedback/panel/help")).toBe(false);
  });

  test("dismiss records the guild's dismissal and collapses the prompt", async () => {
    const { handler, repo, interaction } = setup(true);
    await handler.handleInteraction(
      interaction as unknown as ButtonInteraction,
    );
    expect(repo.recordDismissed).toHaveBeenCalledWith(
      { scope: "guild", id: 200000000000000001n },
      "follow",
    );
    expect(interaction.update).toHaveBeenCalledTimes(1);
  });

  test("refuses clicks from someone who lost permission since the prompt was sent", async () => {
    const { handler, repo, interaction } = setup(false);
    await handler.handleInteraction(
      interaction as unknown as ButtonInteraction,
    );
    expect(repo.recordDismissed).not.toHaveBeenCalled();
    expect(interaction.update).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledTimes(1);
  });
});
