import { describe, expect, it } from "bun:test";
import { PermissionFlagsBits, PermissionsBitField } from "discord.js";
import type { AutocompleteInteraction } from "discord.js";

import { getAutocompleteOwnerFilter } from "./TagAutocomplete";

function makeInteraction(
  commandName: string,
  permissions: bigint,
): AutocompleteInteraction<"cached"> {
  return {
    commandName,
    user: { id: "user-1" },
    member: { permissions: new PermissionsBitField(permissions) },
  } as unknown as AutocompleteInteraction<"cached">;
}

describe("getAutocompleteOwnerFilter", () => {
  it("filters tag-edit to the user's own tags without Manage Guild", () => {
    expect(
      getAutocompleteOwnerFilter(
        makeInteraction("tag-edit", PermissionFlagsBits.SendMessages),
      ),
    ).toBe("user-1");
  });

  it("shows all tags for tag-edit with Manage Guild", () => {
    expect(
      getAutocompleteOwnerFilter(
        makeInteraction("tag-edit", PermissionFlagsBits.ManageGuild),
      ),
    ).toBeUndefined();
  });

  it("shows all tags for tag info regardless of permissions", () => {
    expect(
      getAutocompleteOwnerFilter(makeInteraction("tag", 0n)),
    ).toBeUndefined();
  });

  it("shows all tags for tag-admin", () => {
    expect(
      getAutocompleteOwnerFilter(makeInteraction("tag-admin", 0n)),
    ).toBeUndefined();
  });
});
