import { describe, expect, test } from "bun:test";
import type { Interaction } from "discord.js";

import { productEventNameFor } from "./InteractionRouter";

function interactionOf(kind: string): Interaction {
  const is = (name: string) => () => name === kind;
  return {
    isChatInputCommand: is("command"),
    isContextMenuCommand: is("context_menu"),
    isButton: is("button"),
    isAnySelectMenu: is("select"),
    isModalSubmit: is("modal"),
  } as unknown as Interaction;
}

describe("productEventNameFor", () => {
  test("records what people did", () => {
    expect(productEventNameFor(interactionOf("command"))).toBe(
      "interaction.command",
    );
    expect(productEventNameFor(interactionOf("button"))).toBe(
      "interaction.button",
    );
  });

  test("skips autocomplete, which fires on every keystroke", () => {
    expect(productEventNameFor(interactionOf("autocomplete"))).toBeUndefined();
  });
});
