import { describe, expect, mock, test } from "bun:test";
import {
  AutoModerationRuleTriggerType,
  type Client,
  DiscordAPIError,
  RESTJSONErrorCodes,
} from "discord.js";
import type { Logger } from "pino";

import type { SushiiNotificationService } from "@/shared/infrastructure/SushiiNotificationService";

import type {
  IpGrabberDomain,
  IpGrabberGuildSettings,
  IpGrabberRepository,
} from "../domain/IpGrabberRepository";
import type { IpGrabberProviderId } from "../domain/providers";
import type { IpGrabberMetrics } from "../infrastructure/IpGrabberMetrics";
import { IpGrabberSyncService } from "./IpGrabberSyncService";

const GUILD_ID = "100000000000000001";
const RULE_ID = "300000000000000101";
const OTHER_RULE_ID = "300000000000000102";

class FakeRepository implements IpGrabberRepository {
  settings = new Map<string, IpGrabberGuildSettings>();
  active = new Map<IpGrabberProviderId, string[]>();
  reverted = new Set<string>();
  saves: IpGrabberGuildSettings[] = [];

  async getSettings(guildId: string) {
    return this.settings.get(guildId) ?? null;
  }
  async listConfiguredSettings() {
    return [...this.settings.values()].filter((s) => s.ruleId);
  }
  async saveSettings(settings: IpGrabberGuildSettings) {
    this.saves.push(structuredClone(settings));
    this.settings.set(settings.guildId, structuredClone(settings));
  }
  async listActiveHostnames() {
    return this.active;
  }
  async listRevertedHostnames() {
    return this.reverted;
  }
  async listDomainsToRecheck(): Promise<IpGrabberDomain[]> {
    return [];
  }
  async findDomain() {
    return null;
  }
  async addDomain() {
    return true;
  }
  async recordCheck() {
    return undefined;
  }
  async listPendingReviews(): Promise<IpGrabberDomain[]> {
    return [];
  }
  async markReviewPosted() {
    return undefined;
  }
  async revert() {
    return true;
  }
}

interface FakeRule {
  id: string;
  name: string;
  triggerType: AutoModerationRuleTriggerType;
  triggerMetadata: { keywordFilter: string[] };
  setKeywordFilter: ReturnType<typeof mock>;
}

function makeRule(
  id: string,
  keywords: string[],
  name = "Block links",
): FakeRule {
  const rule: FakeRule = {
    id,
    name,
    triggerType: AutoModerationRuleTriggerType.Keyword,
    triggerMetadata: { keywordFilter: keywords },
    setKeywordFilter: mock(async (next: string[]) => {
      rule.triggerMetadata.keywordFilter = next;
      return rule;
    }),
  };
  return rule;
}

function apiError(status: number, code: number): DiscordAPIError {
  return new DiscordAPIError(
    { code, message: "error" },
    code,
    status,
    "GET",
    "/x",
    {},
  );
}

function setup(rules: FakeRule[], fetchError?: unknown) {
  const repository = new FakeRepository();
  const ruleMap = new Map(rules.map((r) => [r.id, r]));
  const fetch = mock(async (opts?: { autoModerationRule: string }) => {
    if (fetchError) {
      throw fetchError;
    }
    if (!opts) {
      return ruleMap;
    }
    const rule = ruleMap.get(opts.autoModerationRule);
    if (!rule) {
      throw apiError(404, 10_000);
    }
    return rule;
  });
  const guild = { id: GUILD_ID, autoModerationRules: { fetch } };
  const client = {
    guilds: { cache: new Map([[GUILD_ID, guild]]) },
  } as unknown as Client;
  const notify = mock(async () => true);
  const notifications = { notify } as unknown as SushiiNotificationService;
  const metrics = {
    syncCounter: { add: mock(() => undefined) },
  } as unknown as IpGrabberMetrics;
  const logger = {
    info: mock(() => undefined),
    warn: mock(() => undefined),
  } as unknown as Logger;

  const service = new IpGrabberSyncService(
    client,
    repository,
    notifications,
    metrics,
    logger,
  );

  return { service, repository, notify, guild };
}

describe("IpGrabberSyncService", () => {
  test("configure adds the provider's keywords next to the server's own", async () => {
    const rule = makeRule(RULE_ID, ["badword"]);
    const { service, repository } = setup([rule]);

    await service.configure(GUILD_ID, {
      ruleId: RULE_ID,
      providers: ["grabify"],
    });

    const keywords = rule.triggerMetadata.keywordFilter;
    expect(keywords[0]).toBe("badword");
    expect(keywords).toContain("*grabify.link*");
    expect(keywords).not.toContain("*2no.co*");

    const saved = repository.settings.get(GUILD_ID)!;
    expect(saved.managedKeywords).not.toContain("badword");
    expect(saved.managedKeywords).toHaveLength(keywords.length - 1);
    expect(saved.ruleName).toBe("Block links");
    expect(saved.lastError).toBeNull();
  });

  test("stores the managed set before editing the rule", async () => {
    const rule = makeRule(RULE_ID, []);
    const { service, repository } = setup([rule]);
    rule.setKeywordFilter.mockImplementation(async () => {
      throw new Error("crash after the write started");
    });

    await expect(
      service.configure(GUILD_ID, { ruleId: RULE_ID, providers: ["grabify"] }),
    ).rejects.toThrow();

    const saved = repository.settings.get(GUILD_ID)!;
    expect(saved.managedKeywords).toContain("*grabify.link*");
  });

  test("turning off removes only sushii's keywords", async () => {
    const rule = makeRule(RULE_ID, ["badword"]);
    const { service } = setup([rule]);

    await service.configure(GUILD_ID, {
      ruleId: RULE_ID,
      providers: ["grabify", "iplogger"],
    });
    await service.configure(GUILD_ID, { ruleId: null, providers: [] });

    expect(rule.triggerMetadata.keywordFilter).toEqual(["badword"]);
  });

  test("switching rules moves the keywords", async () => {
    const first = makeRule(RULE_ID, ["badword"]);
    const second = makeRule(OTHER_RULE_ID, ["other"], "Second");
    const { service, repository } = setup([first, second]);

    await service.configure(GUILD_ID, {
      ruleId: RULE_ID,
      providers: ["iplogger"],
    });
    await service.configure(GUILD_ID, {
      ruleId: OTHER_RULE_ID,
      providers: ["iplogger"],
    });

    expect(first.triggerMetadata.keywordFilter).toEqual(["badword"]);
    expect(second.triggerMetadata.keywordFilter).toContain("*2no.co*");
    expect(repository.settings.get(GUILD_ID)!.ruleName).toBe("Second");
  });

  test("unticking a provider removes only its keywords", async () => {
    const rule = makeRule(RULE_ID, []);
    const { service } = setup([rule]);

    await service.configure(GUILD_ID, {
      ruleId: RULE_ID,
      providers: ["grabify", "iplogger"],
    });
    await service.configure(GUILD_ID, {
      ruleId: RULE_ID,
      providers: ["grabify"],
    });

    expect(rule.triggerMetadata.keywordFilter).toContain("*grabify.link*");
    expect(rule.triggerMetadata.keywordFilter).not.toContain("*2no.co*");
  });

  test("reverted and discovered domains change the desired set", async () => {
    const rule = makeRule(RULE_ID, []);
    const { service, repository } = setup([rule]);
    repository.active.set("grabify", ["pics-share.click"]);
    repository.reverted.add("mymap.icu");

    await service.configure(GUILD_ID, {
      ruleId: RULE_ID,
      providers: ["grabify"],
    });

    expect(rule.triggerMetadata.keywordFilter).toContain("*pics-share.click*");
    expect(rule.triggerMetadata.keywordFilter).not.toContain("*mymap.icu*");
  });

  test("a deleted rule turns the feature off and alerts once", async () => {
    const rule = makeRule(RULE_ID, []);
    const { service, repository, notify } = setup([rule]);
    await service.configure(GUILD_ID, {
      ruleId: RULE_ID,
      providers: ["grabify"],
    });

    const missing = setup([]);
    missing.repository.settings = repository.settings;
    expect(await missing.service.syncGuild(GUILD_ID, { force: true })).toBe(
      "rule_missing",
    );

    const saved = repository.settings.get(GUILD_ID)!;
    expect(saved.ruleId).toBeNull();
    expect(saved.lastError).toBe("rule_missing");
    expect(missing.notify).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();

    // Off now, so the next sync does nothing.
    expect(await missing.service.syncGuild(GUILD_ID, { force: true })).toBe(
      "skipped",
    );
  });

  test("a full rule is left untouched and alerts only on the first failure", async () => {
    const keywords = Array.from({ length: 995 }, (_, i) => `word${i}`);
    const rule = makeRule(RULE_ID, keywords);
    const { service, repository, notify } = setup([rule]);

    await service.configure(GUILD_ID, {
      ruleId: RULE_ID,
      providers: ["grabify"],
    });
    expect(rule.setKeywordFilter).not.toHaveBeenCalled();
    expect(repository.settings.get(GUILD_ID)!.lastError).toBe("rule_full");
    expect(notify).toHaveBeenCalledTimes(1);

    await service.syncGuild(GUILD_ID, { force: true });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  test("missing permissions are reported", async () => {
    const rule = makeRule(RULE_ID, []);
    const { service, repository } = setup([rule]);
    await service.configure(GUILD_ID, {
      ruleId: RULE_ID,
      providers: ["grabify"],
    });

    const denied = setup(
      [],
      apiError(403, RESTJSONErrorCodes.MissingPermissions),
    );
    denied.repository.settings = repository.settings;
    expect(await denied.service.syncGuild(GUILD_ID, { force: true })).toBe(
      "missing_permission",
    );
    expect(repository.settings.get(GUILD_ID)!.ruleId).toBe(RULE_ID);
  });

  test("an up-to-date guild is skipped without calling Discord", async () => {
    const rule = makeRule(RULE_ID, []);
    const { service, guild } = setup([rule]);
    await service.configure(GUILD_ID, {
      ruleId: RULE_ID,
      providers: ["grabify"],
    });
    guild.autoModerationRules.fetch.mockClear();

    expect(await service.syncGuild(GUILD_ID)).toBe("unchanged");
    expect(guild.autoModerationRules.fetch).not.toHaveBeenCalled();
  });

  test("re-adds a managed keyword the server deleted", async () => {
    const rule = makeRule(RULE_ID, []);
    const { service } = setup([rule]);
    await service.configure(GUILD_ID, {
      ruleId: RULE_ID,
      providers: ["grabify"],
    });
    rule.triggerMetadata.keywordFilter =
      rule.triggerMetadata.keywordFilter.filter((k) => k !== "*grabify.link*");

    expect(await service.syncGuild(GUILD_ID, { force: true })).toBe("updated");
    expect(rule.triggerMetadata.keywordFilter).toContain("*grabify.link*");
  });

  test("getForSettings lists only keyword rules", async () => {
    const keyword = makeRule(RULE_ID, ["a", "b"]);
    const spam = {
      ...makeRule(OTHER_RULE_ID, []),
      triggerType: AutoModerationRuleTriggerType.Spam,
    };
    const { service, guild } = setup([keyword, spam]);

    const state = await service.getForSettings(guild as never);
    expect(state.rules).toEqual([
      { id: RULE_ID, name: "Block links", keywordCount: 2 },
    ]);
    expect(state.ruleId).toBeNull();
  });
});
