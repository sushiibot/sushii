import { describe, expect, mock, test } from "bun:test";

import type { ScreeningVerdictRepository } from "../domain/repositories/ScreeningVerdictRepository";
import type { ScreeningGuildSettings, ScreeningVerdict } from "../domain/types";
import { SCREENING_DEFAULTS, defaultScreeningSettings } from "../domain/types";
import { buildScreeningPost } from "../presentation/views/ScreeningPostView";
import { ScreeningPostRenderer } from "./ScreeningPostRenderer";

const GUILD = "100000000000000001";
const AUTOMOD = { count: 0, rules: [] };

const verdict: ScreeningVerdict = {
  id: 1,
  guildId: GUILD,
  channelId: "300000000000000001",
  userId: "200000000000000001",
  messageId: "500000000000000001",
  kind: "text",
  scores: { scam: 0.6 },
  categories: null,
  topRule: "scam",
  flagged: true,
  avatarHash: null,
  imageKey: null,
  sourceUrl: null,
  joinedAt: new Date("2026-03-10T10:00:00Z"),
  ordinal: 1,
  model: "model",
  cost: 0,
  judged: { context: [], target: [{ author: "member", text: "hi" }] },
  error: null,
  postChannelId: null,
  postMessageId: null,
  outcome: null,
  outcomeBy: null,
  outcomeAction: null,
  ignoreReason: null,
  outcomeAt: null,
  messageDeleted: false,
  createdAt: new Date("2026-03-10T12:00:00Z"),
};

function setup(settings: ScreeningGuildSettings | null) {
  const findByGuildId = mock(async () => settings);
  const verdictRepo = {
    automodSummary: mock(async () => AUTOMOD),
  } as unknown as ScreeningVerdictRepository;
  return {
    renderer: new ScreeningPostRenderer({ findByGuildId }, verdictRepo),
    findByGuildId,
  };
}

function expected(reviewThreshold: number) {
  return buildScreeningPost(verdict, {
    reviewThreshold,
    automod: AUTOMOD,
  }).toJSON();
}

describe("ScreeningPostRenderer", () => {
  test("uses the guild's threshold", async () => {
    const t = setup({
      ...defaultScreeningSettings(GUILD),
      enabled: true,
      logChannelId: "300000000000000009",
      reviewThreshold: 0.5,
    });

    const container = await t.renderer.render(verdict);

    expect(t.findByGuildId).toHaveBeenCalledWith(GUILD);
    expect(container.toJSON()).toEqual(expected(0.5));
  });

  test("keeps the guild's threshold after screening is turned off", async () => {
    const t = setup({
      ...defaultScreeningSettings(GUILD),
      enabled: false,
      logChannelId: null,
      reviewThreshold: 0.5,
    });

    const container = await t.renderer.render(verdict);

    expect(container.toJSON()).toEqual(expected(0.5));
  });

  test("falls back to the default threshold without a settings row", async () => {
    const t = setup(null);

    const container = await t.renderer.render(verdict);

    expect(container.toJSON()).toEqual(
      expected(SCREENING_DEFAULTS.reviewThreshold),
    );
    expect(container.toJSON()).not.toEqual(expected(0.5));
  });
});
