import { expect, test } from "bun:test";

import {
  createFishySuccessMessage,
  createRepSuccessMessage,
} from "./SocialResponseView";

test("reveal shows the collection discovery and points without legacy catch names", () => {
  const payload = createFishySuccessMessage(
    {
      collectibleId: "koi",
      condition: "mist",
      catchCount: 1,
      firstDiscovery: true,
      baseAmount: 10,
      caughtAmount: 10,
      oldAmount: "20",
      newAmount: "30",
      activity: { activeDays: 1, multiplier: 1 },
    },
    "123",
    Buffer.from("synthetic"),
  );
  const json = JSON.stringify(payload.components);
  expect(json).toContain("New discovery: Koi");
  expect(json).toContain("🌫️ Mist hangs over the water.");
  expect(json).not.toContain("Rolling mist");
  expect(json).not.toContain("freshwater");
  expect(json).toContain("received **10 fishies**");
  expect(json).not.toContain("Mrs. Puff");
  expect(json).not.toContain("Browse it with");
  expect(json).toContain("Open collection");
  expect(json).toContain("fishycollection/open");
  expect(payload.allowedMentions).toEqual({ parse: [] });
});

const baseFishy = {
  collectibleId: "koi",
  condition: "still" as const,
  catchCount: 2,
  firstDiscovery: false,
  oldAmount: "20",
  newAmount: "30",
};

test("fishy shows active days and the bonus applied", () => {
  const json = JSON.stringify(
    createFishySuccessMessage(
      {
        ...baseFishy,
        baseAmount: 10,
        caughtAmount: 13,
        activity: { activeDays: 18, multiplier: 1.3 },
      },
      "123",
    ).components,
  );

  expect(json).toContain(
    "Fished 18 of the last 30 days · +30% fishies (10 → 13)",
  );
});

test("fishy hides a bonus that rounded away", () => {
  const small = JSON.stringify(
    createFishySuccessMessage(
      {
        ...baseFishy,
        baseAmount: 10,
        caughtAmount: 10,
        activity: { activeDays: 1, multiplier: 1 + 0.5 / 30 },
      },
      "123",
    ).components,
  );
  const max = JSON.stringify(
    createFishySuccessMessage(
      {
        ...baseFishy,
        baseAmount: 10,
        caughtAmount: 15,
        activity: { activeDays: 30, multiplier: 1.5 },
      },
      "123",
    ).components,
  );

  expect(small).toContain("Fished 1 of the last 30 days · +2% fishies");
  expect(small).not.toContain("→ 10");
  expect(max).toContain(
    "Fished 30 of the last 30 days · +50% fishies (10 → 15)",
  );
});

test("rep shows active days and the bonus chance", () => {
  const json = JSON.stringify(
    createRepSuccessMessage(
      {
        amount: 2,
        isBonus: true,
        oldAmount: "4",
        newAmount: "6",
        activity: { activeDays: 12, multiplier: 1.2 },
      },
      "123",
    ).components,
  );

  expect(json).toContain("You gave <@123> 2 rep!");
  expect(json).toContain(
    "Gave rep 12 of the last 30 days · 20% chance of bonus rep · bonus rep!",
  );
});
