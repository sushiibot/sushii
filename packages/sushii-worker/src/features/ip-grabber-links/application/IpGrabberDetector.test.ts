import { describe, expect, mock, test } from "bun:test";

import {
  type DnsLookup,
  IpGrabberDetector,
  type RedirectProbe,
} from "./IpGrabberDetector";

const ASUID =
  "22D900F6D4115BEB55D6100FB4C0DD9823F4D81DD1C0110A99DC171A7F9F7E2E";
const IPLOGGER_NS = ["rosalyn.ns.cloudflare.com", "bill.ns.cloudflare.com"];

function makeDetector(
  txt: Record<string, string[][]>,
  ns: Record<string, string[]>,
  redirects: Record<string, string> = {},
) {
  const dns: DnsLookup = {
    resolveTxt: mock(async (h: string) => txt[h] ?? null),
    resolveNs: mock(async (h: string) => ns[h] ?? null),
  };
  const http: RedirectProbe = {
    redirectLocation: mock(async (h: string) => redirects[h] ?? null),
  };
  return { detector: new IpGrabberDetector(dns, http), dns, http };
}

describe("IpGrabberDetector", () => {
  test("grabify matches the asuid record on the hostname", async () => {
    const { detector } = makeDetector({ "asuid.mymap.icu": [[ASUID]] }, {});
    expect(await detector.check("grabify", "mymap.icu")).toEqual({
      kind: "match",
      hostname: "mymap.icu",
    });
  });

  test("grabify falls back to a parent domain and joins split TXT chunks", async () => {
    const { detector } = makeDetector(
      { "asuid.example.com": [[ASUID.slice(0, 10), ASUID.slice(10)]] },
      {},
    );
    expect(await detector.check("grabify", "links.example.com")).toEqual({
      kind: "match",
      hostname: "example.com",
    });
  });

  test("grabify ignores other Azure verification IDs", async () => {
    const { detector } = makeDetector({ "asuid.other.com": [["ABC"]] }, {});
    expect(await detector.check("grabify", "other.com")).toEqual({
      kind: "no_match",
    });
  });

  test("iplogger needs both the nameservers and the redirect", async () => {
    const { detector, http } = makeDetector(
      {},
      {
        "2no.co": IPLOGGER_NS,
        "other.co": IPLOGGER_NS,
        "plain.com": ["ns1.host.com"],
      },
      { "2no.co": "https://iplogger.org/", "other.co": "https://example.com/" },
    );

    expect(await detector.check("iplogger", "www.2no.co")).toEqual({
      kind: "match",
      hostname: "2no.co",
    });
    expect(await detector.check("iplogger", "other.co")).toEqual({
      kind: "no_match",
    });
    expect(await detector.check("iplogger", "plain.com")).toEqual({
      kind: "no_match",
    });
    expect(http.redirectLocation).not.toHaveBeenCalledWith("plain.com");
  });

  test("lookup failures are errors, not misses", async () => {
    const { detector, dns } = makeDetector({}, {});
    (dns.resolveTxt as ReturnType<typeof mock>).mockImplementation(async () => {
      throw new Error("SERVFAIL");
    });
    expect((await detector.check("grabify", "mymap.icu")).kind).toBe("error");
  });
});
