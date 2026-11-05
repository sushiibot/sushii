import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";

import type {
  PromptDefinition,
  PromptInteraction,
} from "../domain/PromptDefinition";
import type { PromptStateData, PromptSubject } from "../domain/PromptState";
import type { PromptStateRepository } from "../domain/repositories/PromptStateRepository";
import type { PromptMetrics } from "../infrastructure/PromptMetrics";
import { PromptService } from "./PromptService";

const NOW = new Date("2026-11-04T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function key(subject: PromptSubject, promptId: string) {
  return `${subject.scope}:${subject.id}:${promptId}`;
}

class MemoryRepo implements PromptStateRepository {
  states = new Map<string, PromptStateData>();
  userShown = new Map<bigint, Date>();

  async find(subject: PromptSubject, promptId: string) {
    return this.states.get(key(subject, promptId)) ?? null;
  }
  async claim(
    subject: PromptSubject,
    promptId: string,
    threshold: Date | null,
  ) {
    const state = this.states.get(key(subject, promptId));
    const previous = state?.lastPromptedAt ?? null;
    if (previous && (!threshold || previous >= threshold)) {
      return false as const;
    }
    this.set(subject, promptId, { lastPromptedAt: NOW });
    if (subject.scope === "user") {
      this.userShown.set(subject.id, NOW);
    }
    return { previous };
  }
  async release(
    subject: PromptSubject,
    promptId: string,
    previous: Date | null,
  ) {
    this.set(subject, promptId, { lastPromptedAt: previous });
    if (subject.scope === "user") {
      this.userShown.delete(subject.id);
    }
  }
  async lastShownToUser(userId: bigint) {
    return this.userShown.get(userId) ?? null;
  }
  async recordShownToUser(userId: bigint, _promptId: string, at: Date) {
    this.userShown.set(userId, at);
  }
  async recordSnoozed(
    subject: PromptSubject,
    promptId: string,
    snoozeUntil: Date,
  ) {
    this.set(subject, promptId, { snoozeUntil });
  }
  async recordDismissed(subject: PromptSubject, promptId: string) {
    this.set(subject, promptId, { dismissedAt: NOW });
  }
  async recordCompleted(subject: PromptSubject, promptId: string) {
    this.set(subject, promptId, { completedAt: NOW });
  }
  private set(
    subject: PromptSubject,
    promptId: string,
    fields: Partial<PromptStateData>,
  ) {
    const k = key(subject, promptId);
    this.states.set(k, {
      promptId,
      lastPromptedAt: null,
      snoozeUntil: null,
      dismissedAt: null,
      completedAt: null,
      ...this.states.get(k),
      ...fields,
    });
  }
}

function makeInteraction(id = "1") {
  return {
    id,
    guildId: "200000000000000001",
    user: { id: "100000000000000001" },
    followUp: mock(async () => undefined),
  } as unknown as PromptInteraction & { followUp: ReturnType<typeof mock> };
}

function makeMetrics() {
  return {
    recordShown: mock(),
    recordSkipped: mock(),
    recordAction: mock(),
  } as unknown as PromptMetrics & Record<string, ReturnType<typeof mock>>;
}

const logger = { warn: mock(), error: mock() } as unknown as Logger;

function prompt(overrides: Partial<PromptDefinition> = {}): PromptDefinition {
  return {
    id: "tip",
    scope: "user",
    repeat: null,
    delivery: "explicit",
    eligible: async () => true,
    build: () => ({ text: "hello" }),
    ...overrides,
  } as PromptDefinition;
}

describe("PromptService", () => {
  let repo: MemoryRepo;
  let metrics: ReturnType<typeof makeMetrics>;

  beforeEach(() => {
    repo = new MemoryRepo();
    metrics = makeMetrics();
  });

  function service(prompts: PromptDefinition[]) {
    return new PromptService(repo, prompts, metrics, logger, () => NOW);
  }

  test("a one-shot user prompt is shown once, privately", async () => {
    const svc = service([prompt()]);
    const first = makeInteraction("1");
    await svc.offer(first, "tip");
    expect(first.followUp).toHaveBeenCalledTimes(1);
    const payload = first.followUp.mock.calls[0][0] as { flags: number };
    expect(payload.flags & 64).toBe(64);
    expect(metrics.recordShown).toHaveBeenCalledWith("tip");

    repo.userShown.clear();
    const second = makeInteraction("2");
    await svc.offer(second, "tip");
    expect(second.followUp).not.toHaveBeenCalled();
  });

  test("skips prompts past activeUntil or not eligible", async () => {
    const svc = service([
      prompt({ id: "old", activeUntil: new Date(NOW.getTime() - 1) }),
      prompt({ id: "no", eligible: async () => false }),
    ]);
    const i = makeInteraction();
    await svc.offer(i, "old");
    await svc.offer(i, "no");
    expect(i.followUp).not.toHaveBeenCalled();
  });

  test("the per-user cap blocks a second prompt within 7 days", async () => {
    repo.userShown.set(100000000000000001n, new Date(NOW.getTime() - 6 * DAY));
    const svc = service([prompt()]);
    const i = makeInteraction();
    await svc.offer(i, "tip");
    expect(i.followUp).not.toHaveBeenCalled();
    expect(metrics.recordSkipped).toHaveBeenCalledWith("tip", "cap");

    repo.userShown.set(100000000000000001n, new Date(NOW.getTime() - 8 * DAY));
    const later = makeInteraction("2");
    await svc.offer(later, "tip");
    expect(later.followUp).toHaveBeenCalledTimes(1);
  });

  test("a failed send releases the claim so the prompt isn't used up", async () => {
    const svc = service([prompt()]);
    const i = makeInteraction();
    i.followUp.mockImplementation(async () => {
      throw new Error("Unknown Webhook");
    });
    await svc.offer(i, "tip");
    expect(metrics.recordSkipped).toHaveBeenCalledWith("tip", "send_failed");

    const retry = makeInteraction("2");
    await svc.offer(retry, "tip");
    expect(retry.followUp).toHaveBeenCalledTimes(1);
  });

  test("a guild prompt shown to someone counts toward their cap", async () => {
    const svc = service([
      prompt({ id: "guild", scope: "guild", repeat: { days: 30 } }),
      prompt({ id: "tip" }),
    ]);
    await svc.offer(makeInteraction("1"), "guild");
    expect(repo.userShown.get(100000000000000001n)).toEqual(NOW);

    const i = makeInteraction("2");
    await svc.offer(i, "tip");
    expect(i.followUp).not.toHaveBeenCalled();
  });

  test("only one prompt per interaction", async () => {
    const svc = service([prompt({ id: "a" }), prompt({ id: "b" })]);
    const i = makeInteraction();
    await svc.offer(i, "a");
    repo.userShown.clear();
    await svc.offer(i, "b");
    expect(i.followUp).toHaveBeenCalledTimes(1);
  });

  test("afterCommand skips modal-only and unedited deferred responses", async () => {
    const svc = service([prompt({ delivery: "auto" })]);
    const base = makeInteraction();
    const i = Object.assign(base, {
      inCachedGuild: () => true,
      replied: true,
      deferred: false,
      ephemeral: null,
    });
    await svc.afterCommand(i as never);
    expect(base.followUp).not.toHaveBeenCalled();

    const deferredOnly = Object.assign(makeInteraction("3"), {
      inCachedGuild: () => true,
      replied: false,
      deferred: true,
      ephemeral: false,
    });
    await svc.afterCommand(deferredOnly as never);
    expect(deferredOnly.followUp).not.toHaveBeenCalled();

    const answered = Object.assign(makeInteraction("2"), {
      inCachedGuild: () => true,
      replied: true,
      deferred: false,
      ephemeral: false,
    });
    await svc.afterCommand(answered as never);
    expect(answered.followUp).toHaveBeenCalledTimes(1);
  });

  test("shouldShow respects repeat, snooze, dismiss and completion", () => {
    const svc = service([]);
    const repeating = prompt({
      repeat: { days: 30 },
    } as Partial<PromptDefinition>);
    const base: PromptStateData = {
      promptId: "tip",
      lastPromptedAt: new Date(NOW.getTime() - 31 * DAY),
      snoozeUntil: null,
      dismissedAt: null,
      completedAt: null,
    };
    expect(svc.shouldShow(base, repeating, NOW)).toBe(true);
    expect(
      svc.shouldShow(
        { ...base, lastPromptedAt: new Date(NOW.getTime() - DAY) },
        repeating,
        NOW,
      ),
    ).toBe(false);
    expect(
      svc.shouldShow(
        { ...base, snoozeUntil: new Date(NOW.getTime() + DAY) },
        repeating,
        NOW,
      ),
    ).toBe(false);
    expect(svc.shouldShow({ ...base, dismissedAt: NOW }, repeating, NOW)).toBe(
      false,
    );
    expect(svc.shouldShow({ ...base, completedAt: NOW }, repeating, NOW)).toBe(
      false,
    );
    expect(svc.shouldShow(base, prompt(), NOW)).toBe(false);
  });
});
