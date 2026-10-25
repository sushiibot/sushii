import { expect, test } from "bun:test";

import { CatchableType, calculateStreak } from "../../domain";
import { createFishySuccessMessage } from "./SocialResponseView";

test("reveal shows the collection discovery and points without legacy catch names", () => {
  const payload = createFishySuccessMessage(
    {
      collectibleId: "koi",
      condition: "mist",
      catchCount: 1,
      firstDiscovery: true,
      baseAmount: 10,
      caughtAmount: 10,
      caughtType: CatchableType.MrsPuff,
      oldAmount: "20",
      newAmount: "30",
      streak: calculateStreak(null, 0, new Date()),
    },
    "123",
    Buffer.from("synthetic"),
  );
  const json = JSON.stringify(payload.components);
  expect(json).toContain("New discovery: Koi");
  expect(json).toContain("received **10 fishies**");
  expect(json).not.toContain("Mrs. Puff");
  expect(payload.allowedMentions).toEqual({ parse: [] });
});
