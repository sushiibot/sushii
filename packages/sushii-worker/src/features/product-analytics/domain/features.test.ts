import { Glob } from "bun";
import { describe, expect, test } from "bun:test";

import { featureForEvent } from "./ProductEvent";
import {
  INTERNAL_HANDLERS,
  PRODUCT_FEATURES,
  STAFF_HANDLERS,
  audienceForHandler,
  featureForHandler,
  unitsForFeature,
} from "./features";

const HANDLER_CLASS =
  /class\s+(\w+)(?:<[^>]*>)?\s+extends\s+(?:SlashCommandHandler|ContextMenuHandler|ButtonHandler|SelectMenuHandler|ModalHandler)\b/g;

async function interactionHandlerClasses(): Promise<string[]> {
  const names: string[] = [];
  const featuresDir = `${import.meta.dir}/../..`;
  for await (const path of new Glob("**/*.ts").scan(featuresDir)) {
    if (path.endsWith(".test.ts")) {
      continue;
    }
    const source = await Bun.file(`${featuresDir}/${path}`).text();
    for (const match of source.matchAll(HANDLER_CLASS)) {
      names.push(match[1]);
    }
  }
  return names;
}

describe("product features", () => {
  test("suggested proof events and handlers belong to a guild feature", () => {
    for (const name of [
      "proof_suggestion.shown",
      "proof_suggestion.added",
      "proof_suggestion.undone",
    ] as const) {
      expect(featureForEvent({ name, userId: "123", guildId: "456" })).toBe(
        "proof-suggestions",
      );
    }
    for (const handler of [
      "ProofSuggestionButtonHandler",
      "ProofSuggestionSelectHandler",
    ]) {
      expect(featureForHandler(handler)).toBe("proof-suggestions");
      expect(audienceForHandler(handler)).toBe("staff");
      expect(PRODUCT_FEATURES.moderation.handlers).not.toContain(handler);
    }
    expect(unitsForFeature("proof-suggestions")).toEqual(["guild"]);
    expect(
      featureForEvent({ name: "proof.added", userId: "123", guildId: "456" }),
    ).toBe("moderation");
  });
  test("every interaction handler belongs to a feature or is internal", async () => {
    const names = await interactionHandlerClasses();
    expect(names.length).toBeGreaterThan(50);

    const unmapped = names.filter(
      (name) =>
        featureForHandler(name) === "unmatched" &&
        !INTERNAL_HANDLERS.includes(name),
    );
    expect(unmapped).toEqual([]);
  });

  test("every permission-gated handler is staff", async () => {
    const gated: string[] = [];
    const featuresDir = `${import.meta.dir}/../..`;
    for await (const path of new Glob("**/*.ts").scan(featuresDir)) {
      if (path.endsWith(".test.ts")) {
        continue;
      }
      const source = await Bun.file(`${featuresDir}/${path}`).text();
      if (source.includes("setDefaultMemberPermissions")) {
        gated.push(...[...source.matchAll(HANDLER_CLASS)].map((m) => m[1]));
      }
    }
    expect(gated.length).toBeGreaterThan(20);

    const missed = gated.filter(
      (name) =>
        !STAFF_HANDLERS.includes(name) && !INTERNAL_HANDLERS.includes(name),
    );
    expect(missed).toEqual([]);
  });

  test("splits a feature's setup from what members use", () => {
    expect(audienceForHandler("RoleMenuCommand")).toBe("staff");
    expect(audienceForHandler("RoleMenuButtonHandler")).toBe("member");
    expect(audienceForHandler("NoSuchHandler")).toBeUndefined();
    expect(audienceForHandler(undefined)).toBeUndefined();
  });

  test("no handler is listed twice", () => {
    const all = Object.values(PRODUCT_FEATURES).flatMap((f) => f.handlers);
    expect(new Set(all).size).toBe(all.length);
  });

  test("an unknown or missing handler is unmatched", () => {
    expect(featureForHandler("NoSuchHandler")).toBe("unmatched");
    expect(featureForHandler(undefined)).toBe("unmatched");
  });
});
