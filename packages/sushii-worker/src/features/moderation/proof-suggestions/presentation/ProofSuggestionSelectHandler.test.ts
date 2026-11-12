import { describe, expect, mock, test } from "bun:test";
import type { AnySelectMenuInteraction } from "discord.js";

import { makeCase } from "@/features/moderation/actions/presentation/response/testFixtures";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";

import { ProofSuggestionSelectHandler } from "./ProofSuggestionSelectHandler";
import { createModLogSuggestionOffer } from "./modLogSuggestionOffer";
import { OUT_OF_DATE_TEXT } from "./suggestionText";
import { deletedSuggestion, recentSuggestion } from "./testFixtures";
import { buildPicker } from "./views";

function picker() {
  const message = buildPicker(
    {
      caseId: "4822",
      fingerprint: "0a1b2c3d",
      targetId: "912345678901234567",
      targetName: "spambot",
      actionType: ActionType.Ban,
      items: [deletedSuggestion(), recentSuggestion()].map((suggestion) => ({
        suggestion,
        channelName: "general",
        image: null,
      })),
      addOtherProofId: "caseProof/add/4822",
    },
    new Set([0]),
  );
  return message.components.map((c) => {
    const data = c.toJSON();
    return { toJSON: () => data };
  });
}

function interaction(customId: string, values: string[]) {
  return {
    customId,
    values,
    message: { components: picker() },
    inCachedGuild: () => true,
    memberPermissions: { any: () => true },
    reply: mock(async (_o: unknown) => undefined),
    update: mock(async (_o: unknown) => undefined),
  };
}

describe("ProofSuggestionSelectHandler", () => {
  test("updates the Add count in place without deferring", async () => {
    const i = interaction("proof/suggest/select/4822/0a1b2c3d", ["0", "1"]);
    await new ProofSuggestionSelectHandler().handleInteraction(
      i as unknown as AnySelectMenuInteraction,
    );

    expect(i.reply).not.toHaveBeenCalled();
    expect(JSON.stringify(i.update.mock.calls[0][0])).toContain(
      '"label":"Add 2"',
    );
  });

  test("a garbled id is out of date", async () => {
    const i = interaction("proof/suggest/select/garbled", ["0"]);
    await new ProofSuggestionSelectHandler().handleInteraction(
      i as unknown as AnySelectMenuInteraction,
    );

    expect(i.update).not.toHaveBeenCalled();
    expect(JSON.stringify(i.reply.mock.calls[0][0])).toContain(
      OUT_OF_DATE_TEXT,
    );
  });
});

describe("createModLogSuggestionOffer", () => {
  test("offers the button only with the flag on and candidates to find", async () => {
    const hasCandidates = mock(async () => true);
    const listByCase = mock(async () => []);
    const on = createModLogSuggestionOffer({
      caseProofRepository: { listByCase },
      flags: { isEnabled: async () => true },
      suggestions: { hasCandidates },
    });
    expect(await on.buttonFor(makeCase())).toBe(
      "proof/suggest/review/4822/log",
    );
    expect(
      await on.buttonFor(makeCase({ actionType: ActionType.BanRemove })),
    ).toBeNull();

    const off = createModLogSuggestionOffer({
      caseProofRepository: { listByCase },
      flags: { isEnabled: async () => false },
      suggestions: { hasCandidates },
    });
    hasCandidates.mockClear();
    listByCase.mockClear();
    expect(await off.buttonFor(makeCase())).toBeNull();
    expect(hasCandidates).not.toHaveBeenCalled();
    expect(listByCase).not.toHaveBeenCalled();

    const none = createModLogSuggestionOffer({
      caseProofRepository: { listByCase },
      flags: { isEnabled: async () => true },
      suggestions: { hasCandidates: async () => false },
    });
    expect(await none.buttonFor(makeCase())).toBeNull();
  });
});
