import { describe, expect, test } from "bun:test";

import {
  extractHostnames,
  hostnameCandidates,
  normalizeHostname,
} from "./hostnames";

describe("extractHostnames", () => {
  test("finds hosts in plain, hidden-preview and markdown links", () => {
    const content =
      "look https://MyMap.icu/abc and <https://2no.co/x> [here](https://pics.example.org/a?b=1)";
    expect(extractHostnames(content)).toEqual([
      "mymap.icu",
      "2no.co",
      "pics.example.org",
    ]);
  });

  test("skips popular sites and their subdomains", () => {
    expect(
      extractHostnames(
        "https://media.discordapp.net/x https://www.youtube.com/watch https://tenor.com/a",
      ),
    ).toEqual([]);
  });

  test("ignores text without a scheme, IPs and duplicates", () => {
    expect(
      extractHostnames(
        "mymap.icu http://192.168.1.1/x https://a.com https://A.com/b",
      ),
    ).toEqual(["a.com"]);
  });

  test("stops at the limit", () => {
    const content = Array.from(
      { length: 20 },
      (_, i) => `https://h${i}.com`,
    ).join(" ");
    expect(extractHostnames(content, 3)).toHaveLength(3);
  });
});

describe("normalizeHostname", () => {
  test("drops userinfo, port and trailing dots", () => {
    expect(normalizeHostname("user@Grabify.link.:443")).toBe("grabify.link");
  });

  test("rejects hosts without a dot or with odd characters", () => {
    expect(normalizeHostname("localhost")).toBeNull();
    expect(normalizeHostname("exa_mple.com")).toBeNull();
    expect(normalizeHostname("[::1]")).toBeNull();
  });
});

describe("hostnameCandidates", () => {
  test("walks up to the last two labels", () => {
    expect(hostnameCandidates("a.b.example.com")).toEqual([
      "a.b.example.com",
      "b.example.com",
      "example.com",
    ]);
    expect(hostnameCandidates("example.com")).toEqual(["example.com"]);
  });
});
