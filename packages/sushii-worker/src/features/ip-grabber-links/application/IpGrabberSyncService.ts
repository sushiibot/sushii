import {
  type AutoModerationRule,
  AutoModerationRuleTriggerType,
  type Client,
  DiscordAPIError,
  type Guild,
  RESTJSONErrorCodes,
} from "discord.js";
import type { Logger } from "pino";

import type { SushiiNotificationService } from "@/shared/infrastructure/SushiiNotificationService";

import type {
  IpGrabberGuildSettings,
  IpGrabberRepository,
  IpGrabberSyncError,
} from "../domain/IpGrabberRepository";
import {
  MAX_RULE_KEYWORDS,
  mergeKeywords,
  toKeywords,
} from "../domain/keywords";
import {
  IP_GRABBER_PROVIDERS,
  IP_GRABBER_PROVIDER_IDS,
  type IpGrabberProviderId,
} from "../domain/providers";
import type { IpGrabberMetrics } from "../infrastructure/IpGrabberMetrics";
import { syncErrorNotification } from "../presentation/views/IpGrabberNotificationView";
import type {
  IpGrabberSettingsPort,
  IpGrabberSettingsState,
  KeywordRuleOption,
} from "./IpGrabberSettingsPort";

const AUDIT_REASON = "sushii: IP grabber links";
const RULE_LIST_TIMEOUT_MS = 1500;
const FULL_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type IpGrabberCatalog = ReadonlyMap<
  IpGrabberProviderId,
  ReadonlySet<string>
>;

export type SyncOutcome =
  | "unchanged"
  | "updated"
  | "skipped"
  | IpGrabberSyncError;

function isPermissionError(err: unknown): boolean {
  return (
    err instanceof DiscordAPIError &&
    (err.code === RESTJSONErrorCodes.MissingPermissions ||
      err.code === RESTJSONErrorCodes.MissingAccess)
  );
}

function isNotFound(err: unknown): boolean {
  return err instanceof DiscordAPIError && err.status === 404;
}

function sameKeywords(a: readonly string[], b: readonly string[]): boolean {
  const set = new Set(a);
  return a.length === b.length && b.every((k) => set.has(k));
}

export class IpGrabberSyncService implements IpGrabberSettingsPort {
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly client: Client,
    private readonly repository: IpGrabberRepository,
    private readonly notifications: SushiiNotificationService,
    private readonly metrics: IpGrabberMetrics,
    private readonly logger: Logger,
  ) {}

  async loadCatalog(): Promise<IpGrabberCatalog> {
    const [active, reverted] = await Promise.all([
      this.repository.listActiveHostnames(),
      this.repository.listRevertedHostnames(),
    ]);

    const catalog = new Map<IpGrabberProviderId, Set<string>>();
    for (const id of IP_GRABBER_PROVIDER_IDS) {
      const hostnames = new Set([
        ...IP_GRABBER_PROVIDERS[id].seedDomains,
        ...(active.get(id) ?? []),
      ]);
      for (const hostname of reverted) {
        hostnames.delete(hostname);
      }
      catalog.set(id, hostnames);
    }

    return catalog;
  }

  desiredKeywords(
    catalog: IpGrabberCatalog,
    providers: readonly IpGrabberProviderId[],
  ): string[] {
    return toKeywords(providers.flatMap((id) => [...(catalog.get(id) ?? [])]));
  }

  /** Runs one sync per guild at a time on this cluster. */
  private withLock<T>(guildId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(guildId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(fn);
    this.locks.set(guildId, next);
    void next
      .catch(() => undefined)
      .finally(() => {
        if (this.locks.get(guildId) === next) {
          this.locks.delete(guildId);
        }
      });

    return next;
  }

  async syncGuild(
    guildId: string,
    opts: { catalog?: IpGrabberCatalog; force?: boolean } = {},
  ): Promise<SyncOutcome> {
    return this.withLock(guildId, async () => {
      const settings = await this.repository.getSettings(guildId);
      if (!settings?.ruleId) {
        return "skipped";
      }

      const catalog = opts.catalog ?? (await this.loadCatalog());
      const desired = this.desiredKeywords(catalog, settings.providers);
      const fullCheckDue =
        !settings.lastSyncedAt ||
        Date.now() - settings.lastSyncedAt.getTime() > FULL_CHECK_INTERVAL_MS;
      if (
        !opts.force &&
        !fullCheckDue &&
        !settings.lastError &&
        sameKeywords(desired, settings.managedKeywords)
      ) {
        return "unchanged";
      }

      const outcome = await this.writeRule(settings, desired);
      this.metrics.syncCounter.add(1, { outcome });
      return outcome;
    });
  }

  /** Writes `desired` into the settings' rule and stores what sushii owns. */
  private async writeRule(
    settings: IpGrabberGuildSettings,
    desired: string[],
    opts: { quiet?: boolean } = {},
  ): Promise<SyncOutcome> {
    const guild = this.client.guilds.cache.get(settings.guildId);
    if (!guild || !settings.ruleId) {
      return "skipped";
    }

    let rule: AutoModerationRule;
    try {
      rule = await guild.autoModerationRules.fetch({
        autoModerationRule: settings.ruleId,
        force: true,
      });
    } catch (err) {
      if (isNotFound(err)) {
        return this.fail(settings, "rule_missing", opts);
      }
      if (isPermissionError(err)) {
        return this.fail(settings, "missing_permission", opts);
      }
      throw err;
    }

    if (rule.triggerType !== AutoModerationRuleTriggerType.Keyword) {
      return this.fail(settings, "rule_missing", opts);
    }

    const merge = mergeKeywords({
      ruleKeywords: rule.triggerMetadata.keywordFilter,
      previouslyManaged: settings.managedKeywords,
      desired,
    });
    if (merge.next.length > MAX_RULE_KEYWORDS) {
      return this.fail(settings, "rule_full", { ...opts, ruleName: rule.name });
    }

    if (merge.changed) {
      // Saved first so a crash after the edit still knows which keywords are sushii's.
      await this.repository.saveSettings({
        ...settings,
        managedKeywords: [
          ...new Set([...settings.managedKeywords, ...merge.managed]),
        ],
      });

      try {
        await rule.setKeywordFilter(merge.next, AUDIT_REASON);
      } catch (err) {
        if (isPermissionError(err)) {
          return this.fail(settings, "missing_permission", opts);
        }
        if (isNotFound(err)) {
          return this.fail(settings, "rule_missing", opts);
        }
        throw err;
      }
    }

    await this.repository.saveSettings({
      ...settings,
      ruleName: rule.name,
      managedKeywords: merge.managed,
      lastSyncedAt: new Date(),
      lastError: null,
    });

    if (merge.changed) {
      this.logger.info(
        {
          guildId: settings.guildId,
          ruleId: settings.ruleId,
          managed: merge.managed.length,
        },
        "Synced IP grabber keywords",
      );
    }

    return merge.changed ? "updated" : "unchanged";
  }

  private async fail(
    settings: IpGrabberGuildSettings,
    error: IpGrabberSyncError,
    opts: { quiet?: boolean; ruleName?: string } = {},
  ): Promise<SyncOutcome> {
    const ruleName = opts.ruleName ?? settings.ruleName;
    // A deleted rule turns the feature off; its keywords went with it.
    const next: IpGrabberGuildSettings =
      error === "rule_missing"
        ? { ...settings, ruleId: null, managedKeywords: [], lastError: error }
        : { ...settings, ruleName, lastError: error };
    await this.repository.saveSettings(next);

    if (!opts.quiet && settings.lastError !== error) {
      await this.notifications.notify(
        settings.guildId,
        syncErrorNotification(error, ruleName),
      );
    }

    this.logger.info(
      { guildId: settings.guildId, ruleId: settings.ruleId, error },
      "IP grabber sync failed",
    );

    return error;
  }

  async configure(
    guildId: string,
    input: { ruleId: string | null; providers: IpGrabberProviderId[] },
  ): Promise<void> {
    await this.withLock(guildId, async () => {
      const current = await this.repository.getSettings(guildId);
      const providers = input.ruleId ? input.providers : [];

      // Take sushii's keywords out of a rule that's being switched away from or turned off.
      if (
        current?.ruleId &&
        current.managedKeywords.length > 0 &&
        current.ruleId !== input.ruleId
      ) {
        // The old rule may be gone or locked; nothing to clean up then.
        await this.writeRule(current, [], { quiet: true });
      }

      const base: IpGrabberGuildSettings =
        current && current.ruleId === input.ruleId
          ? current
          : {
              guildId,
              ruleId: input.ruleId,
              ruleName: null,
              managedKeywords: [],
              providers: [],
              lastSyncedAt: null,
              lastError: null,
            };

      const settings: IpGrabberGuildSettings = {
        ...base,
        ruleId: input.ruleId,
        providers,
        lastError: null,
      };
      await this.repository.saveSettings(settings);

      if (!settings.ruleId) {
        return;
      }

      const desired = this.desiredKeywords(await this.loadCatalog(), providers);
      const outcome = await this.writeRule(settings, desired);
      this.metrics.syncCounter.add(1, { outcome });
    });
  }

  async getForSettings(guild: Guild): Promise<IpGrabberSettingsState> {
    const [settings, rules] = await Promise.all([
      this.repository.getSettings(guild.id),
      this.listKeywordRules(guild),
    ]);

    return {
      ruleId: settings?.ruleId ?? null,
      ruleName: settings?.ruleName ?? null,
      providers: settings?.providers ?? [],
      keywordCount: settings?.managedKeywords.length ?? 0,
      lastSyncedAt: settings?.lastSyncedAt ?? null,
      problem: settings?.lastError ?? null,
      rules,
    };
  }

  private async listKeywordRules(
    guild: Guild,
  ): Promise<KeywordRuleOption[] | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const rules = await Promise.race([
        guild.autoModerationRules.fetch(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("AutoMod rule list timed out")),
            RULE_LIST_TIMEOUT_MS,
          );
        }),
      ]);

      return [...rules.values()]
        .filter(
          (rule) => rule.triggerType === AutoModerationRuleTriggerType.Keyword,
        )
        .map((rule) => ({
          id: rule.id,
          name: rule.name,
          keywordCount: rule.triggerMetadata.keywordFilter.length,
        }));
    } catch (err) {
      if (!isPermissionError(err)) {
        this.logger.warn(
          { err, guildId: guild.id },
          "Failed to list AutoMod rules",
        );
      }
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
