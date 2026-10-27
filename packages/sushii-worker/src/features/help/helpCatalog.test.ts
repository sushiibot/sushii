import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type {
  APITextDisplayComponent,
  Client,
  RESTPostAPIApplicationCommandsJSONBody,
} from "discord.js";
import {
  ComponentType,
  PermissionFlagsBits,
  PermissionsBitField,
} from "discord.js";
import { EventEmitter } from "node:events";

import InteractionRouter from "@/core/cluster/discord/InteractionRouter";
import { registerFeatures } from "@/core/cluster/initialization/registerFeatures";
import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import type { InteractionMetrics } from "@/shared/infrastructure/metrics/InteractionMetrics";
import { fallbackMention } from "@/shared/presentation/commandMentions";
import { ALL_EMOJIS, KNOWN_MENTIONS } from "@/test/fixtures/help";

import { buildHelpIndex } from "./application/helpIndex";
import {
  HELP_CATEGORIES,
  HELP_EMOJI_NAMES,
  HELP_HIDDEN,
} from "./domain/helpCatalog";
import { buildHelpChoices } from "./presentation/HelpSearchAutocomplete";
import { buildHelpDetail } from "./presentation/views/HelpDetailView";

function catalogNames(): string[] {
  return HELP_CATEGORIES.flatMap((c) => [
    ...c.commands.map((x) => x.name),
    ...(c.apps ?? []),
  ]);
}

describe("help catalog", () => {
  let registered: RESTPostAPIApplicationCommandsJSONBody[];
  let cleanup: () => void;

  beforeAll(() => {
    const client = Object.assign(new EventEmitter(), {
      rest: {},
    }) as unknown as Client;
    const deploymentService = {
      isCurrentDeploymentActive: () => true,
    } as unknown as DeploymentService;
    const router = new InteractionRouter(
      client,
      deploymentService,
      {} as InteractionMetrics,
    );
    const features = registerFeatures(
      {} as Parameters<typeof registerFeatures>[0],
      client,
      deploymentService,
      router,
      { mention: fallbackMention },
    );
    cleanup = features.cleanup;
    registered = router.getCommandsArray();
  });

  afterAll(() => {
    cleanup();
  });

  // getCommandsArray() covers global commands only; guild-registered commands aren't checked.
  test("every registered global command is in a category, an apps list or hidden", () => {
    const listed = new Set([
      ...HELP_HIDDEN,
      ...HELP_CATEGORIES.flatMap((c) => [
        ...c.commands.map((cmd) => cmd.name),
        ...(c.apps ?? []),
      ]),
    ]);

    const missing = registered
      .map((c) => c.name)
      .filter((name) => !listed.has(name));

    expect(missing).toEqual([]);
  });

  test("every catalog command and app is registered globally", () => {
    const names = new Set(registered.map((c) => c.name));
    const unknown = catalogNames().filter((name) => !names.has(name));

    expect(unknown).toEqual([]);
  });

  test("lists each command once", () => {
    const names = catalogNames();

    expect(names.length).toBe(new Set(names).size);
  });

  test("loads every category emoji", () => {
    const loaded = new Set<string>(HELP_EMOJI_NAMES);

    expect(HELP_CATEGORIES.filter((c) => !loaded.has(c.emoji))).toEqual([]);
  });

  test("newUntil values are valid dates", () => {
    const invalid = HELP_CATEGORIES.flatMap((c) => c.commands).filter(
      (c) => c.newUntil !== undefined && Number.isNaN(Date.parse(c.newUntil)),
    );

    expect(invalid).toEqual([]);
  });

  test("every registered command's detail card fits in 40 components and 4000 characters", () => {
    const entries = buildHelpIndex(registered);
    const admin = new PermissionsBitField(PermissionFlagsBits.Administrator);

    for (const entry of entries) {
      const container = buildHelpDetail({
        query: entry.path,
        entries,
        memberPermissions: admin,
        emojis: ALL_EMOJIS,
        mentions: KNOWN_MENTIONS,
        guildId: "167058919611564043",
      }).components[0].toJSON();
      const characters = container.components
        .filter(
          (c): c is APITextDisplayComponent =>
            c.type === ComponentType.TextDisplay,
        )
        .reduce((n, c) => n + c.content.length, 0);

      expect(1 + container.components.length).toBeLessThanOrEqual(40);
      expect(characters).toBeLessThanOrEqual(4000);
    }
  });

  test("every entry's autocomplete choice has no emoji and fits 100 characters", () => {
    const entries = buildHelpIndex(registered);
    const admin = new PermissionsBitField(PermissionFlagsBits.Administrator);
    const emoji = /\p{Extended_Pictographic}/u;

    for (const entry of entries) {
      const choice = buildHelpChoices(
        entries,
        entry.path,
        admin,
        new Date(),
      )[0];

      expect(choice.value).toBe(entry.path);
      expect(emoji.test(choice.name)).toBe(false);
      expect(Array.from(choice.name).length).toBeLessThanOrEqual(100);
      expect(Array.from(choice.value).length).toBeLessThanOrEqual(100);
    }
  });
});
