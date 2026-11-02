import { promises as dns } from "node:dns";

import type {
  DnsLookup,
  RedirectProbe,
} from "../application/IpGrabberDetector";

const DNS_TIMEOUT_MS = 3000;
const HTTP_TIMEOUT_MS = 5000;
const NO_RECORD_CODES = new Set(["ENOTFOUND", "ENODATA"]);

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("DNS lookup timed out")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function orNullWhenMissing<T>(lookup: Promise<T>): Promise<T | null> {
  try {
    return await withTimeout(lookup, DNS_TIMEOUT_MS);
  } catch (err) {
    if (
      err instanceof Error &&
      "code" in err &&
      NO_RECORD_CODES.has(String(err.code))
    ) {
      return null;
    }
    throw err;
  }
}

export class NodeDnsLookup implements DnsLookup {
  resolveTxt(hostname: string): Promise<string[][] | null> {
    return orNullWhenMissing(dns.resolveTxt(hostname));
  }

  resolveNs(hostname: string): Promise<string[] | null> {
    return orNullWhenMissing(dns.resolveNs(hostname));
  }
}

export class FetchRedirectProbe implements RedirectProbe {
  async redirectLocation(hostname: string): Promise<string | null> {
    const response = await fetch(`https://${hostname}/`, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });

    return response.status >= 300 && response.status < 400
      ? response.headers.get("location")
      : null;
  }
}
