import { hostnameCandidates } from "../domain/hostnames";
import type { IpGrabberProviderId } from "../domain/providers";

// Azure App Service domain verification ID shared by every Grabify tracking domain.
const GRABIFY_ASUID =
  "22D900F6D4115BEB55D6100FB4C0DD9823F4D81DD1C0110A99DC171A7F9F7E2E";
// Shared by many Cloudflare accounts, so only a filter before the redirect check.
const IPLOGGER_NAMESERVERS = [
  "bill.ns.cloudflare.com",
  "rosalyn.ns.cloudflare.com",
];
const IPLOGGER_HOST = "iplogger.org";

export interface DnsLookup {
  /** Null when the name has no such records. Throws on lookup failures. */
  resolveTxt(hostname: string): Promise<string[][] | null>;
  resolveNs(hostname: string): Promise<string[] | null>;
}

export interface RedirectProbe {
  /** The Location of a redirect from `https://<hostname>/`, or null. */
  redirectLocation(hostname: string): Promise<string | null>;
}

/** `error` means the check couldn't run, which is not evidence either way. */
export type CheckResult =
  | { kind: "match"; hostname: string }
  | { kind: "no_match" }
  | { kind: "error"; err: unknown };

export class IpGrabberDetector {
  constructor(
    private readonly dns: DnsLookup,
    private readonly http: RedirectProbe,
  ) {}

  async check(
    provider: IpGrabberProviderId,
    hostname: string,
  ): Promise<CheckResult> {
    try {
      const matched =
        provider === "grabify"
          ? await this.checkGrabify(hostname)
          : await this.checkIpLogger(hostname);
      return matched
        ? { kind: "match", hostname: matched }
        : { kind: "no_match" };
    } catch (err) {
      return { kind: "error", err };
    }
  }

  private async checkGrabify(hostname: string): Promise<string | null> {
    for (const candidate of hostnameCandidates(hostname)) {
      const records = await this.dns.resolveTxt(`asuid.${candidate}`);
      if (records?.some((chunks) => chunks.join("") === GRABIFY_ASUID)) {
        return candidate;
      }
    }

    return null;
  }

  private async checkIpLogger(hostname: string): Promise<string | null> {
    const zone = await this.findZone(hostname);
    if (!zone) {
      return null;
    }

    const nameservers = zone.nameservers
      .map((ns) => ns.toLowerCase().replace(/\.$/, ""))
      .sort();
    if (
      nameservers.length !== IPLOGGER_NAMESERVERS.length ||
      nameservers.some((ns, i) => ns !== IPLOGGER_NAMESERVERS[i])
    ) {
      return null;
    }

    if (zone.hostname === IPLOGGER_HOST) {
      return zone.hostname;
    }

    const location = await this.http.redirectLocation(zone.hostname);
    if (!location) {
      return null;
    }

    let target: string;
    try {
      target = new URL(location, `https://${zone.hostname}/`).hostname;
    } catch {
      // An unparseable Location isn't an IPLogger redirect.
      return null;
    }

    return target === IPLOGGER_HOST || target.endsWith(`.${IPLOGGER_HOST}`)
      ? zone.hostname
      : null;
  }

  /** The closest name at or above `hostname` with NS records. */
  private async findZone(
    hostname: string,
  ): Promise<{ hostname: string; nameservers: string[] } | null> {
    for (const candidate of hostnameCandidates(hostname)) {
      const nameservers = await this.dns.resolveNs(candidate);
      if (nameservers && nameservers.length > 0) {
        return { hostname: candidate, nameservers };
      }
    }

    return null;
  }
}
