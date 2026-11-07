import { describe, expect, mock, spyOn, test } from "bun:test";
import { pino } from "pino";

import type { CaseProofCounts } from "@/features/moderation/shared/domain/repositories/CaseProofRepository";

import { type LiveModView, createModViewRegistry } from "./modViewRegistry";

const GUILD = "111111111111111111";
const OTHER_GUILD = "999999999999999999";

function makeView(
  overrides: Partial<{
    guildId: string;
    caseIds: string[];
    editableUntil: number;
    show: (counts: Map<string, CaseProofCounts>) => Promise<void>;
  }> = {},
) {
  const showProofCounts = mock(
    overrides.show ??
      ((_counts: Map<string, CaseProofCounts>) => Promise.resolve()),
  );
  const view: LiveModView = {
    guildId: overrides.guildId ?? GUILD,
    caseIds: () => overrides.caseIds ?? ["1", "2"],
    canEdit: (now) => now < (overrides.editableUntil ?? Infinity),
    showProofCounts,
  };
  return { view, showProofCounts };
}

function setup(now = 1_000) {
  const counts = new Map<string, CaseProofCounts>([
    ["2", { entries: 1, files: 3 }],
  ]);
  const countsByCases = mock(async (_g: string, _ids: string[]) => counts);
  const logger = pino({ level: "silent" });
  const registry = createModViewRegistry({
    caseProofRepository: { countsByCases },
    logger,
    now: () => now,
  });
  return { registry, countsByCases, counts, logger };
}

describe("modViewRegistry", () => {
  test("refreshes a registered view holding one of the cases", async () => {
    const { registry, countsByCases, counts } = setup();
    const { view, showProofCounts } = makeView();
    registry.register(view);

    await registry.proofChanged(GUILD, ["2"]);

    expect(countsByCases).toHaveBeenCalledWith(GUILD, ["1", "2"]);
    expect(showProofCounts).toHaveBeenCalledWith(counts);
  });

  test("skips views in another guild or without the cases", async () => {
    const { registry, countsByCases } = setup();
    const otherGuild = makeView({ guildId: OTHER_GUILD });
    const otherCases = makeView({ caseIds: ["7"] });
    registry.register(otherGuild.view);
    registry.register(otherCases.view);

    await registry.proofChanged(GUILD, ["2"]);

    expect(countsByCases).not.toHaveBeenCalled();
    expect(otherGuild.showProofCounts).not.toHaveBeenCalled();
    expect(otherCases.showProofCounts).not.toHaveBeenCalled();
  });

  test("an unregistered view is no longer refreshed", async () => {
    const { registry } = setup();
    const { view, showProofCounts } = makeView();
    registry.register(view);
    registry.unregister(view);

    await registry.proofChanged(GUILD, ["2"]);

    expect(showProofCounts).not.toHaveBeenCalled();
  });

  test("drops a view past its edit window", async () => {
    const { registry } = setup(5_000);
    const { view, showProofCounts } = makeView({ editableUntil: 5_000 });
    registry.register(view);

    await registry.proofChanged(GUILD, ["2"]);

    expect(showProofCounts).not.toHaveBeenCalled();
  });

  test("a failing refresh is logged, doesn't throw, and doesn't stop the others", async () => {
    const { registry, logger } = setup();
    const failing = makeView({
      show: () => Promise.reject(new Error("Unknown Webhook")),
    });
    const ok = makeView();
    registry.register(failing.view);
    registry.register(ok.view);
    const warn = spyOn(logger, "warn");

    await expect(registry.proofChanged(GUILD, ["2"])).resolves.toBeUndefined();

    expect(ok.showProofCounts).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatchObject({ guildId: GUILD });
  });

  test("a failing count load doesn't throw", async () => {
    const { registry, countsByCases } = setup();
    countsByCases.mockImplementation(() =>
      Promise.reject(new Error("db down")),
    );
    const { view, showProofCounts } = makeView();
    registry.register(view);

    await expect(registry.proofChanged(GUILD, ["2"])).resolves.toBeUndefined();
    expect(showProofCounts).not.toHaveBeenCalled();
  });

  test("a view that throws while matching doesn't throw", async () => {
    const { registry } = setup();
    registry.register({
      guildId: GUILD,
      caseIds: () => {
        throw new Error("bad");
      },
      canEdit: () => true,
      showProofCounts: () => Promise.resolve(),
    });

    await expect(registry.proofChanged(GUILD, ["2"])).resolves.toBeUndefined();
  });
});
