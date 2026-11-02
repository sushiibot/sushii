import { describe, expect, test } from "bun:test";

import type { IpGrabberDomain } from "../../domain/IpGrabberRepository";
import { buildIpGrabberReviewMessage } from "./IpGrabberReviewView";
import { parseRevertId } from "./ipGrabberCustomIds";

const DOMAIN: IpGrabberDomain = {
  hostname: "pics-share.click",
  provider: "grabify",
  source: "discovered",
  status: "active",
  firstSeenGuildId: "100000000000000001",
  firstSeenGuildName: "KPOP Hub",
  firstSeenChannelId: "200000000000000001",
  firstSeenChannelName: "general",
  reviewStatus: "pending",
  reviewMessageId: null,
  failedChecks: 0,
  createdAt: new Date("2026-11-02T11:58:00Z"),
};

function render(...args: Parameters<typeof buildIpGrabberReviewMessage>) {
  return JSON.stringify(
    buildIpGrabberReviewMessage(...args).components.map((c) => c.toJSON()),
  );
}

describe("buildIpGrabberReviewMessage", () => {
  test("shows the hostname, the match and where it was seen, with a Revert button", () => {
    const json = render(DOMAIN);
    expect(json).toContain("pics-share.click");
    expect(json).toContain("KPOP Hub · #general");
    expect(json).toContain('"label":"Revert"');

    const customId = JSON.parse(json)[0].components.at(-1).accessory.custom_id;
    expect(parseRevertId(customId)).toBe("pics-share.click");
  });

  test("endpoint domains say where they came from", () => {
    expect(render({ ...DOMAIN, source: "endpoint" })).toContain(
      "Grabify's published domain list",
    );
  });

  test("reverted state disables the button", () => {
    const json = render(DOMAIN, {
      userId: "150443906511667200",
      at: new Date("2026-11-02T12:00:00Z"),
    });
    expect(json).toContain("Reverted by <@150443906511667200>");
    expect(json).toContain('"disabled":true');
  });
});
