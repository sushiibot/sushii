import { describe, expect, test } from "bun:test";

import { discordImageLink, extractImageLinks } from "./imageLinks";

describe("discordImageLink", () => {
  test("keys by pathname, ignoring host and signature", () => {
    const a = discordImageLink(
      "https://cdn.discordapp.com/attachments/1/2/x.png?ex=1&is=2&hm=3",
    );
    const b = discordImageLink(
      "https://media.discordapp.net/attachments/1/2/x.png?ex=9",
    );
    expect(a?.key).toBe("/attachments/1/2/x.png");
    expect(b?.key).toBe(a?.key);
  });

  test("rejects third-party hosts, http and non-image files", () => {
    expect(discordImageLink("https://i.imgur.com/x.png")).toBeNull();
    expect(
      discordImageLink("http://cdn.discordapp.com/attachments/1/2/x.png"),
    ).toBeNull();
    expect(
      discordImageLink("https://cdn.discordapp.com/attachments/1/2/file.zip"),
    ).toBeNull();
    expect(discordImageLink("not a url")).toBeNull();
  });
});

describe("extractImageLinks", () => {
  test("dedupes and caps at 3", () => {
    const content =
      [1, 2, 3, 4]
        .map((i) => `https://cdn.discordapp.com/attachments/1/${i}/a.gif`)
        .join(" ") + " https://cdn.discordapp.com/attachments/1/1/a.gif?ex=2";
    const links = extractImageLinks(content, []);
    expect(links.map((l) => l.key)).toEqual([
      "/attachments/1/1/a.gif",
      "/attachments/1/2/a.gif",
      "/attachments/1/3/a.gif",
    ]);
  });

  test("dedupes a re-shared link with a fresh signature", () => {
    const content =
      "https://cdn.discordapp.com/attachments/1/1/a.gif?ex=1 https://media.discordapp.net/attachments/1/1/a.gif?ex=2";
    expect(extractImageLinks(content, [])).toHaveLength(1);
  });

  test("strips markdown wrappers and trailing punctuation", () => {
    const content = [
      "||https://cdn.discordapp.com/attachments/1/1/a.png||",
      "**https://cdn.discordapp.com/attachments/1/2/b.jpg**",
      "look https://cdn.discordapp.com/attachments/1/3/c.webp.",
    ].join(" ");
    expect(extractImageLinks(content, []).map((l) => l.url)).toEqual([
      "https://cdn.discordapp.com/attachments/1/1/a.png",
      "https://cdn.discordapp.com/attachments/1/2/b.jpg",
      "https://cdn.discordapp.com/attachments/1/3/c.webp",
    ]);
  });

  test("strips a trailing comma after a signed link", () => {
    const links = extractImageLinks(
      "https://cdn.discordapp.com/attachments/1/1/a.gif?ex=1&hm=2, and more",
      [],
    );
    expect(links.map((l) => l.url)).toEqual([
      "https://cdn.discordapp.com/attachments/1/1/a.gif?ex=1&hm=2",
    ]);
  });

  test("falls back to the thumbnail when the embed image is unusable", () => {
    const links = extractImageLinks("", [
      {
        image: { proxy_url: "https://i.imgur.com/x.jpg" },
        thumbnail: {
          proxy_url:
            "https://media.discordapp.net/external/t/https/i.imgur.com/x.jpg",
        },
      },
    ]);
    expect(links.map((l) => l.key)).toEqual([
      "/external/t/https/i.imgur.com/x.jpg",
    ]);
  });

  test("reads raw embed proxy_url from image and thumbnail", () => {
    const links = extractImageLinks("https://i.imgur.com/x.jpg", [
      {
        image: {
          proxy_url:
            "https://media.discordapp.net/external/abc/https/i.imgur.com/x.jpg",
        },
        thumbnail: {
          proxy_url:
            "https://media.discordapp.net/external/thumb/https/i.imgur.com/t.jpg",
        },
      },
      {
        thumbnail: {
          proxy_url:
            "https://media.discordapp.net/external/def/https/i.imgur.com/y.png",
        },
      },
      { image: null, thumbnail: { proxy_url: null } },
    ]);
    expect(links.map((l) => l.key)).toEqual([
      "/external/abc/https/i.imgur.com/x.jpg",
      "/external/thumb/https/i.imgur.com/t.jpg",
      "/external/def/https/i.imgur.com/y.png",
    ]);
  });
});
