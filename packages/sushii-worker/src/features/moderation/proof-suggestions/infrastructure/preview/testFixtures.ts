import type { PreviewAuthor, PreviewMessage, PreviewRequest } from "./types";

export const GUILD_ID = "167058919611564043";
export const SPAMBOT_ID = "1158796463532630016";

export function author(
  id: string,
  displayName: string,
  overrides: Partial<PreviewAuthor> = {},
): PreviewAuthor {
  return {
    id,
    displayName,
    memberAvatarHash: null,
    userAvatarHash: null,
    discriminator: "0",
    isApp: false,
    ...overrides,
  };
}

export const spambot = author(SPAMBOT_ID, "spambot");
export const alice = author("150443906511667200", "alice");
export const bob = author("268609384484577280", "bob");
export const vega = author("405212349875191818", "vega");
export const postIt = author("1012345678901234567", "PostIt", { isApp: true });

let nextId = 1_300_000_000_000_000_000n;

export function msg(
  from: PreviewAuthor,
  time: string,
  content: string,
  overrides: Partial<PreviewMessage> = {},
): PreviewMessage {
  nextId += 1n;
  return {
    id: nextId.toString(),
    author: from,
    createdAt: new Date(`2026-11-10T${time}Z`),
    content,
    attachmentNames: [],
    deleted: false,
    automodFlagged: false,
    ...overrides,
  };
}

export function request(
  messages: PreviewMessage[],
  overrides: Partial<PreviewRequest> = {},
): PreviewRequest {
  return {
    guildId: GUILD_ID,
    channelName: "general",
    subtitle: "preview",
    targetUserId: SPAMBOT_ID,
    messages,
    hiddenEarlierCount: 0,
    ...overrides,
  };
}

const SPAM =
  "FREE NITRO 🎁 first 100 only → https://dlscord-gift.com/claim/8f2k";

/** 214 spam messages with chatter mixed in, like a raid account before a ban. */
export function spamFixture(): PreviewRequest {
  const messages: PreviewMessage[] = [
    msg(alice, "18:20:00", "whats going on in here"),
  ];
  for (let i = 0; i < 214; i++) {
    const seconds = 60 + i * 3;
    const time = `18:${String(20 + Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    const content =
      i % 30 === 29 ? "join now https://discord.gg/fr33n1tr0" : SPAM;
    messages.push(msg(spambot, time, content, { deleted: true }));
    if (i % 50 === 10) {
      messages.push(msg(vega, time, "mods??"));
    }
  }
  messages.push(msg(spambot, "18:31:50", "bye 😂", { deleted: true }));
  messages.push(msg(bob, "18:32:00", "finally"));
  return request(messages, {
    subtitle: "18:20 – 18:31 · last 10 of 214 from spambot",
  });
}

export function koreanEmojiFixture(): PreviewRequest {
  return request(
    [
      msg(alice, "18:29:00", "anyone know when the comeback stage starts?"),
      msg(
        spambot,
        "18:29:20",
        "hey <@150443906511667200> check your DMs 👀 got something for you",
        {
          deleted: true,
        },
      ),
      msg(bob, "18:30:00", "그거 열지 마세요 사기예요 ㅋㅋ"),
      ...Array.from({ length: 14 }, (_, i) =>
        msg(
          i % 2 ? alice : bob,
          `18:3${Math.floor(i / 3)}:${String(10 + i).padStart(2, "0")}`,
          "ㅋㅋㅋ 진짜?",
        ),
      ),
      msg(
        spambot,
        "18:35:00",
        "**FREE NITRO** 🎁 first 100 only → https://dlscord-gift.com/claim/8f2k?ref=a8Hk2LmQ9zXv0pR7tY3wE6uI1oP4sD5fG",
        { deleted: true },
      ),
      msg(spambot, "18:35:10", "무료 니트로 받으세요 ||진짜 비밀 링크||", {
        deleted: true,
        attachmentNames: ["free_nitro.png"],
      }),
      msg(
        vega,
        "18:36:00",
        "<@1158796463532630016> stop <:pepeban:123456789012345678>",
      ),
      msg(
        spambot,
        "18:36:20",
        "😂😂 ok\n`code` and <#167058919611564043>\n> quoted line",
        {
          deleted: true,
          automodFlagged: true,
        },
      ),
    ],
    { subtitle: "18:29 – 18:36 · 4 from spambot" },
  );
}

export function appResponseFixture(): PreviewRequest {
  return request(
    [
      msg(alice, "18:32:00", "new teaser is so good"),
      msg(
        postIt,
        "18:33:00",
        "leaked full MV here 🔥 https://grabify.link/K2X9PQ",
        {
          deleted: true,
          triggeredBy: "spambot",
          triggeredById: SPAMBOT_ID,
        },
      ),
      msg(bob, "18:33:30", "don't click that"),
    ],
    {
      channelName: "media",
      subtitle: "18:33 · app response triggered by spambot",
    },
  );
}
