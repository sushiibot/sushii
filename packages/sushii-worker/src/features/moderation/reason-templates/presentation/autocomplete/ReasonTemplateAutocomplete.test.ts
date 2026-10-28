import { describe, expect, test } from "bun:test";

import { reasonAutocompleteCommandNames } from "./ReasonTemplateAutocomplete";

describe("reasonAutocompleteCommandNames", () => {
  test("covers the mod action commands with a reason option", () => {
    expect(reasonAutocompleteCommandNames().sort()).toEqual([
      "ban",
      "kick",
      "softban",
      "tempban",
      "timeout",
      "unban",
      "untimeout",
      "warn",
    ]);
  });
});
