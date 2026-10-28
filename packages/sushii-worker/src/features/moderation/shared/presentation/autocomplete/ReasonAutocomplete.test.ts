import { describe, expect, mock, test } from "bun:test";
import type {
  AutocompleteFocusedOption,
  AutocompleteInteraction,
} from "discord.js";
import { ApplicationCommandOptionType } from "discord.js";
import pino from "pino";

import { CaseRangeAutocompleteService } from "@/features/moderation/cases/application/CaseRangeAutocompleteService";

import { ReasonAutocomplete } from "./ReasonAutocomplete";

const GUILD_ID = "1029384756102938475";

function setup() {
  const caseService = Object.create(
    CaseRangeAutocompleteService.prototype,
  ) as CaseRangeAutocompleteService;
  caseService.getAutocompleteSuggestions = mock(() =>
    Promise.resolve([{ name: "#12", value: "12" }]),
  );
  const reasonChoices = mock((_guildId: string, _input: string) =>
    Promise.resolve([{ name: "!spam · Spamming.", value: "!spam" }]),
  );
  const respond = mock((_choices: unknown) => Promise.resolve());
  const interaction = {
    guildId: GUILD_ID,
    inCachedGuild: () => true,
    respond,
  } as unknown as AutocompleteInteraction;

  const handler = new ReasonAutocomplete(
    caseService,
    reasonChoices,
    pino({ level: "silent" }),
  );

  return { handler, interaction, respond, caseService, reasonChoices };
}

function option(name: string, value: string): AutocompleteFocusedOption {
  return {
    name,
    value,
    focused: true,
    type: ApplicationCommandOptionType.String,
  };
}

describe("ReasonAutocomplete", () => {
  test("case option keeps case range suggestions", async () => {
    const { handler, interaction, respond, reasonChoices } = setup();

    await handler.handler(interaction, option("case", "1"));

    expect(respond).toHaveBeenCalledWith([{ name: "#12", value: "12" }]);
    expect(reasonChoices).not.toHaveBeenCalled();
  });

  test("reason option gets template choices", async () => {
    const { handler, interaction, respond, caseService, reasonChoices } =
      setup();

    await handler.handler(interaction, option("reason", "sp"));

    expect(reasonChoices).toHaveBeenCalledWith(GUILD_ID, "sp");
    expect(respond).toHaveBeenCalledWith([
      { name: "!spam · Spamming.", value: "!spam" },
    ]);
    expect(caseService.getAutocompleteSuggestions).not.toHaveBeenCalled();
  });

  test("any other option gets no choices", async () => {
    const { handler, interaction, respond, caseService, reasonChoices } =
      setup();

    await handler.handler(interaction, option("other", "x"));

    expect(respond).toHaveBeenCalledWith([]);
    expect(caseService.getAutocompleteSuggestions).not.toHaveBeenCalled();
    expect(reasonChoices).not.toHaveBeenCalled();
  });
});
