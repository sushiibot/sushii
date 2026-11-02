import type { IpGrabberProviderId } from "./providers";

export type IpGrabberSyncError =
  | "rule_missing"
  | "rule_full"
  | "missing_permission";

export interface IpGrabberGuildSettings {
  guildId: string;
  ruleId: string | null;
  ruleName: string | null;
  providers: IpGrabberProviderId[];
  /** Keywords sushii added to `ruleId`, and only those. */
  managedKeywords: string[];
  lastSyncedAt: Date | null;
  lastError: IpGrabberSyncError | null;
}

export type IpGrabberDomainSource = "endpoint" | "discovered";

export interface IpGrabberDomain {
  hostname: string;
  provider: IpGrabberProviderId;
  source: IpGrabberDomainSource;
  status: "active" | "stale" | "reverted";
  firstSeenGuildId: string | null;
  firstSeenGuildName: string | null;
  firstSeenChannelId: string | null;
  firstSeenChannelName: string | null;
  reviewStatus: "pending" | "posted" | "reverted";
  reviewMessageId: string | null;
  failedChecks: number;
  createdAt: Date;
}

export interface NewIpGrabberDomain {
  hostname: string;
  provider: IpGrabberProviderId;
  source: IpGrabberDomainSource;
  firstSeenGuildId?: string;
  firstSeenGuildName?: string;
  firstSeenChannelId?: string;
  firstSeenChannelName?: string;
}

export interface IpGrabberRepository {
  getSettings(guildId: string): Promise<IpGrabberGuildSettings | null>;
  listConfiguredSettings(): Promise<IpGrabberGuildSettings[]>;
  saveSettings(settings: IpGrabberGuildSettings): Promise<void>;

  /** Active hostnames per provider; excludes stale and reverted ones. */
  listActiveHostnames(): Promise<Map<IpGrabberProviderId, string[]>>;
  /** Hostnames that must never be blocked again (reverted by the owner). */
  listRevertedHostnames(): Promise<Set<string>>;
  listDomainsToRecheck(): Promise<IpGrabberDomain[]>;
  findDomain(hostname: string): Promise<IpGrabberDomain | null>;
  /**
   * Inserts a new active domain, or reactivates a stale one. Returns false
   * when the hostname is already active or was reverted.
   */
  addDomain(domain: NewIpGrabberDomain): Promise<boolean>;
  recordCheck(
    hostname: string,
    passed: boolean,
    staleAfter: number,
  ): Promise<void>;

  listPendingReviews(): Promise<IpGrabberDomain[]>;
  markReviewPosted(hostname: string, messageId: string): Promise<void>;
  /** Atomically moves a posted review to reverted; false if already resolved. */
  revert(hostname: string): Promise<boolean>;
}
