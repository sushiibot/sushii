import { describe, expect, mock, test } from "bun:test";

import {
  type AvatarCdn,
  AvatarResolver,
  type FetchImage,
  avatarInitial,
  defaultAvatarIndex,
  fallbackAvatarColor,
} from "./AvatarResolver";
import { GUILD_ID, author } from "./testFixtures";

const cdn: AvatarCdn = {
  guildMemberAvatar: (guildId, userId, hash) =>
    `member/${guildId}/${userId}/${hash}`,
  avatar: (id, hash) => `user/${id}/${hash}`,
  defaultAvatar: (index) => `embed/avatars/${index}.png`,
};

const png = (byte: number) => new Uint8Array([0x89, 0x50, byte]);

const withHashes = author("268609384484577280", "bob", {
  memberAvatarHash: "mhash",
  userAvatarHash: "uhash",
});

describe("AvatarResolver", () => {
  test("falls back from a failing member avatar to the user avatar", async () => {
    const fetchImage = mock<FetchImage>(async (url) => {
      if (url.startsWith("member/")) {
        throw new Error("network down");
      }
      return new Response(png(2));
    });
    const resolver = new AvatarResolver(cdn, fetchImage);

    const avatars = await resolver.resolveAll(GUILD_ID, [withHashes]);

    expect(avatars.get(withHashes.id)).toEqual(Buffer.from(png(2)));
    expect(fetchImage.mock.calls.map(([url]) => url)).toEqual([
      `member/${GUILD_ID}/${withHashes.id}/mhash`,
      `user/${withHashes.id}/uhash`,
    ]);
  });

  test("tries member, user, then the Discord default avatar url", () => {
    const resolver = new AvatarResolver(cdn);
    const legacy = author("80351110224678912", "legacy", {
      discriminator: "1337",
    });

    expect(resolver.candidateUrls(GUILD_ID, withHashes)).toEqual([
      `member/${GUILD_ID}/${withHashes.id}/mhash`,
      `user/${withHashes.id}/uhash`,
      `embed/avatars/${defaultAvatarIndex(withHashes)}.png`,
    ]);
    expect(resolver.candidateUrls(GUILD_ID, legacy)).toEqual([
      `embed/avatars/${1337 % 5}.png`,
    ]);
  });

  test("falls back to the default avatar when both custom avatars fail", async () => {
    const fetchImage = mock<FetchImage>(async (url) =>
      url.startsWith("embed/")
        ? new Response(png(3))
        : new Response(null, { status: 404 }),
    );
    const resolver = new AvatarResolver(cdn, fetchImage);

    const avatars = await resolver.resolveAll(GUILD_ID, [withHashes]);

    expect(avatars.get(withHashes.id)).toEqual(Buffer.from(png(3)));
    expect(fetchImage).toHaveBeenCalledTimes(3);
  });

  test("leaves the author out when every candidate fails", async () => {
    const resolver = new AvatarResolver(
      cdn,
      async () => new Response(null, { status: 404 }),
    );

    const avatars = await resolver.resolveAll(GUILD_ID, [withHashes]);

    expect(avatars.has(withHashes.id)).toBe(false);
  });

  test("rejects avatars over the byte cap", async () => {
    const resolver = new AvatarResolver(
      cdn,
      async () => new Response(new Uint8Array(65 * 1024)),
    );

    const avatars = await resolver.resolveAll(GUILD_ID, [withHashes]);

    expect(avatars.has(withHashes.id)).toBe(false);
  });

  test("never rejects when the CDN helper throws", async () => {
    const throwing: AvatarCdn = {
      ...cdn,
      defaultAvatar: () => {
        throw new Error("bad index");
      },
    };
    const resolver = new AvatarResolver(
      throwing,
      async () => new Response(png(1)),
    );

    const avatars = await resolver.resolveAll(GUILD_ID, [withHashes]);

    expect(avatars.size).toBe(0);
  });

  test("leaves the author out when fetches outlast the timeout", async () => {
    const resolver = new AvatarResolver(
      cdn,
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
      { timeoutMs: 20 },
    );

    const avatars = await resolver.resolveAll(GUILD_ID, [withHashes]);

    expect(avatars.has(withHashes.id)).toBe(false);
  });

  test("fetches each unique author once and caches by url", async () => {
    const fetchImage = mock<FetchImage>(async () => new Response(png(1)));
    const resolver = new AvatarResolver(cdn, fetchImage);
    const userOnly = author("150443906511667200", "alice", {
      userAvatarHash: "a",
    });

    await resolver.resolveAll(GUILD_ID, [userOnly, userOnly]);
    await resolver.resolveAll(GUILD_ID, [userOnly]);

    expect(fetchImage).toHaveBeenCalledTimes(1);
  });

  test("picks default avatar indexes and colors like Discord", () => {
    expect(defaultAvatarIndex(author("80351110224678912", "nelly"))).toBe(
      Number((80351110224678912n >> 22n) % 6n),
    );
    expect(
      defaultAvatarIndex(
        author("80351110224678912", "legacy", { discriminator: "1337" }),
      ),
    ).toBe(1337 % 5);
    expect(defaultAvatarIndex(author("not-a-snowflake", "x"))).toBe(0);
    expect(fallbackAvatarColor(author("-4194304", "x"))).toBe("#5865f2");
  });
});

describe("avatarInitial", () => {
  test.each([
    ["alice", "A"],
    ["  bob", "B"],
    ["ßeta", "SS"],
    ["그거", "그"],
    ["👨‍👩‍👧 family", "👨‍👩‍👧"],
    ["🇰🇷 fan", "🇰🇷"],
    ["Z̷̢̛͉a̴lgo", "Z"],
    ["\u0301abc", "?"],
    ["", "?"],
    ["   ", "?"],
    ["!!!", "?"],
  ])("%j → %j", (name, expected) => {
    expect(avatarInitial(name)).toBe(expected);
  });
});
