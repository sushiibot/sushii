import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AnySelectMenuInteraction } from "discord.js";
import {
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import pino from "pino";

import type { ScreeningMetrics } from "../../domain/ScreeningMetrics";
import type { ScreeningVerdictRepository } from "../../domain/repositories/ScreeningVerdictRepository";
import type { ScreeningVerdict } from "../../domain/types";
import { ScreeningIgnoreSelectHandler } from "./ScreeningIgnoreSelectHandler";

const GUILD = "187450744427773963";
const OTHER_GUILD = "187450744427773964";
const USER = "1202420700607029308";
const MOD = "150443906511667200";
const POST = "1558174981962079999";
const VERDICT_ID = 9431;

function verdict(overrides: Partial<ScreeningVerdict> = {}): ScreeningVerdict {
  return {
    id: VERDICT_ID,
    guildId: GUILD,
    userId: USER,
    postMessageId: POST,
    ...overrides,
  } as ScreeningVerdict;
}

function makeRepo() {
  return {
    findById: mock(async (): Promise<ScreeningVerdict | null> => verdict()),
    setIgnored: mock(async (): Promise<ScreeningVerdict[]> => [verdict()]),
  };
}

function makeInteraction(opts: { value?: string; granted?: bigint[] } = {}) {
  const granted = opts.granted ?? [PermissionFlagsBits.ManageMessages];
  return {
    customId: `/screening/ignore/${VERDICT_ID}`,
    guildId: GUILD,
    user: { id: MOD },
    message: { id: POST },
    values: [opts.value ?? "too_minor"],
    memberPermissions: { any: (p: bigint) => granted.includes(p) },
    inCachedGuild: () => true,
    isStringSelectMenu: () => true,
    reply: mock(async () => undefined),
    update: mock(async () => undefined),
    deferUpdate: mock(async () => undefined),
  };
}

describe("ScreeningIgnoreSelectHandler", () => {
  let repo: ReturnType<typeof makeRepo>;
  let container: ContainerBuilder;
  let renderer: { renderPost: ReturnType<typeof mock> };
  let metrics: {
    recordCheck: ReturnType<typeof mock>;
    recordOutcome: ReturnType<typeof mock>;
  };
  let handler: ScreeningIgnoreSelectHandler;

  beforeEach(() => {
    repo = makeRepo();
    container = new ContainerBuilder();
    renderer = { renderPost: mock(async () => container) };
    metrics = { recordCheck: mock(), recordOutcome: mock() };
    handler = new ScreeningIgnoreSelectHandler(
      repo as unknown as ScreeningVerdictRepository,
      renderer,
      metrics as ScreeningMetrics,
      pino({ level: "silent" }),
    );
  });

  async function run(interaction: ReturnType<typeof makeInteraction>) {
    await handler.handleInteraction(
      interaction as unknown as AnySelectMenuInteraction,
    );
  }

  test("matches the ignore custom id", () => {
    expect(
      handler.customIDMatch(`/screening/ignore/${VERDICT_ID}`),
    ).toBeTruthy();
  });

  test("denies members without Manage Messages", async () => {
    const interaction = makeInteraction({
      granted: [PermissionFlagsBits.BanMembers],
    });

    await run(interaction);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(repo.findById).not.toHaveBeenCalled();
    expect(repo.setIgnored).not.toHaveBeenCalled();
  });

  test("rejects an unknown reason", async () => {
    const interaction = makeInteraction({ value: "spam" });

    await run(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
    expect(repo.setIgnored).not.toHaveBeenCalled();
  });

  test("throws on a corrupted verdict id", async () => {
    const interaction = makeInteraction();
    interaction.customId = "/screening/ignore/0";

    await expect(run(interaction)).rejects.toThrow(
      "Invalid screening verdict id",
    );
    expect(repo.findById).not.toHaveBeenCalled();
  });

  test("throws when the ignored post has no verdict to render", async () => {
    renderer.renderPost.mockResolvedValueOnce(null);
    const interaction = makeInteraction();

    await expect(run(interaction)).rejects.toThrow(
      "Ignored screening post has no verdict",
    );
    expect(interaction.update).not.toHaveBeenCalled();
  });

  test("refuses a verdict from another guild", async () => {
    repo.findById.mockResolvedValueOnce(verdict({ guildId: OTHER_GUILD }));
    const interaction = makeInteraction();

    await run(interaction);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(repo.setIgnored).not.toHaveBeenCalled();
  });

  test("refuses a missing verdict", async () => {
    repo.findById.mockResolvedValueOnce(null);
    const interaction = makeInteraction();

    await run(interaction);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(repo.setIgnored).not.toHaveBeenCalled();
  });

  test("acknowledges silently when the post is already resolved", async () => {
    repo.setIgnored.mockResolvedValueOnce([]);
    const interaction = makeInteraction();

    await run(interaction);

    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(interaction.update).not.toHaveBeenCalled();
    expect(renderer.renderPost).not.toHaveBeenCalled();
    expect(metrics.recordOutcome).not.toHaveBeenCalled();
  });

  test("ignores the post, re-renders it and records the reason", async () => {
    const interaction = makeInteraction({ value: "allowed_here" });

    await run(interaction);

    expect(repo.findById).toHaveBeenCalledWith(VERDICT_ID);
    expect(repo.setIgnored).toHaveBeenCalledWith(
      POST,
      MOD,
      "allowed_here",
      expect.any(Date),
    );
    expect(renderer.renderPost).toHaveBeenCalledWith(POST);
    expect(interaction.update).toHaveBeenCalledWith({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });
    expect(metrics.recordOutcome).toHaveBeenCalledWith("ignored", {
      source: "button",
      reason: "allowed_here",
    });
  });
});
