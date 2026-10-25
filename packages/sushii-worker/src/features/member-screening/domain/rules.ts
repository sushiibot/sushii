import type {
  ScreeningGuildSettings,
  ScreeningRule,
  ScreeningRuleId,
} from "./types";

/** Jev reads literally, so each rule's yes/no boundary lives in `criteria` with examples on both sides. */
export const SCREENING_RULES: readonly ScreeningRule[] = [
  {
    id: "scam",
    title: "scam",
    instructions:
      "Does `new_message.text` try to trick people into handing over money, account access, or personal information?",
    criteria: {
      true: {
        what: "A lure or con: free Nitro/gift/giveaway links, fake Discord staff or support, 'I accidentally reported you', fake fan-club or presale verification, QR codes or links to 'verify' or 'claim', crypto or investment offers, 'test my game' downloads, or an invitation to see private pics in a bio.",
        examples: [
          "free nitro, claim before it expires: dlscord.com/gift",
          "sorry i accidentally reported you, message discord support @dsc_help or you get banned",
          "scan this QR code to get the verified role",
          "I made $4,800 this week trading crypto, DM me",
        ],
      },
      false: {
        what: "Ordinary chat, including asking for a link, offering to be friends, warning others about scams, or buying, selling, or trading items with other members, even with 'DM me', prices, deposits, or payment methods.",
        examples: [
          "can u send the link in my dms?",
          "selling my extra tickets, $80 each, PayPal G&S, dm me",
          "group order for the lightstick, $15 deposit, dm me",
          "DM me if you wanna be friends!",
          "never click free nitro links, it's always a scam",
          "where can i buy the official lightstick?",
        ],
      },
    },
  },
  {
    id: "sale",
    title: "buying/selling",
    optIn: true,
    instructions:
      "Does `new_message.text` offer to sell, buy, or trade something with other members?",
    criteria: {
      true: {
        what: "Buying, selling, or trading between members: tickets, photocards, albums, lightsticks, merch, group orders, or accounts.",
        examples: [
          "selling 2 floor seats, can't go anymore, DM me",
          "WTS jennie POB pc",
          "WTB rose pc, paying well",
          "opening a group order, $15 deposit",
        ],
      },
      false: {
        what: "Talking about merch, albums, or tickets without offering a deal, such as asking where to buy officially or saying what they bought.",
        examples: [
          "i bought the album yesterday, the pcs are so pretty",
          "are tickets for the LA show sold out?",
          "where can i buy the official lightstick?",
        ],
      },
    },
  },
  {
    id: "promo",
    title: "self-promotion",
    instructions:
      "Does `new_message.text` advertise another Discord server or the member's own social media, channel, or business?",
    criteria: {
      true: {
        what: "Self-promotion or advertising: Discord invite links, asking people to follow, subscribe to, or join the member's own account, channel, or server.",
        examples: [
          "join my kpop server discord.gg/abc",
          "follow my tiktok @lisa.edits pls",
          "sub to my youtube, just uploaded a cover",
        ],
      },
      false: {
        what: "Sharing idol content, GIFs, music bot commands, links to this server's channels, mentioning their own account without asking for follows, or offering items for sale or trade.",
        examples: [
          "selling my signed albums and merch, DM me, more photos on my Mercari",
          "here is lisa's performance https://youtu.be/abc",
          "https://klipy.com/gifs/hi-hello-328",
          "+play https://youtu.be/xyz",
          "go here its more active <#123>",
          "my lisa edit got 1k views, so happy",
        ],
      },
    },
  },
  {
    id: "sexual",
    title: "sexual content",
    instructions:
      "Is `new_message.text` sexually explicit or a sexual solicitation?",
    criteria: {
      true: {
        what: "Explicit sexual descriptions, requests for nudes or sexting, or offers of sexual content.",
        examples: [
          "anyone wanna sext? dm me",
          "send nudes",
          "describe what you'd do to her body in bed",
        ],
      },
      false: {
        what: "Calling an idol hot, pretty, or sexy, crushes, swearing, or crude usernames.",
        examples: [
          "lisa is so hot omg marry me",
          "that stage was sexy asf",
          "fuck yeah new album friday",
        ],
      },
    },
  },
  {
    id: "hate",
    title: "hate speech",
    instructions:
      "Does `new_message.text` attack or demean people for their race, ethnicity, nationality, religion, gender, sexuality, or disability?",
    criteria: {
      true: {
        what: "Slurs, dehumanizing statements, or insults aimed at a group or at a person because of that group.",
        examples: [
          "all chinese people are rats",
          "gay people shouldn't be allowed here",
        ],
      },
      false: {
        what: "Mentioning nationality or identity neutrally, criticizing slurs, or disliking a song, group, or fandom.",
        examples: [
          "the chinese version of the song is so good",
          "stop saying slurs in chat",
          "twice is better than blackpink fight me",
        ],
      },
    },
  },
  {
    id: "harassment",
    title: "harassment",
    instructions:
      "Does `new_message.text` insult, threaten, or tell someone to harm themselves, aimed at a specific person?",
    criteria: {
      true: {
        what: "Insults, threats, 'kys', or calls to pile on aimed at a specific member or named person.",
        examples: [
          "@x you're ugly, kys",
          "shut up you stupid bitch nobody asked",
          "i know where you live, watch your back",
          "everyone spam her dms",
        ],
      },
      false: {
        what: "Banter between friends, complaining about the server being quiet, opinions about songs or idols, or swearing not aimed at anyone.",
        examples: [
          "bro you're stupid for that one lmaooo",
          "this server so dead",
          "honestly her lyrics be cringe",
          "shitty ass server 😭",
        ],
      },
    },
  },
  {
    id: "underage",
    title: "under 13",
    instructions:
      "Does `new_message.text` state that the member themselves is currently under 13 years old?",
    criteria: {
      true: {
        what: "A first-person statement of current age 12 or younger.",
        examples: [
          "im 12",
          "i'm 11 but my mom lets me use discord",
          "just turned 10 today",
        ],
      },
      false: {
        what: "Ages 13 or older, other people's ages, years of being a fan, or asking about age limits.",
        examples: [
          "i'm 14",
          "my sister is 11",
          "12 years into stanning",
          "what's the age limit?",
        ],
      },
    },
  },
];

export function rulesFor(
  settings: ScreeningGuildSettings,
): readonly ScreeningRule[] {
  const { rules } = settings;
  if (rules === null) {
    return SCREENING_RULES.filter((r) => !r.optIn);
  }
  return SCREENING_RULES.filter((r) => rules.includes(r.id));
}

export function topRule(
  scores: Partial<Record<ScreeningRuleId, number>>,
): ScreeningRuleId | null {
  let best: ScreeningRuleId | null = null;
  let bestScore = -Infinity;
  for (const r of SCREENING_RULES) {
    const p = scores[r.id];
    if (p !== undefined && p > bestScore) {
      best = r.id;
      bestScore = p;
    }
  }
  return best;
}
