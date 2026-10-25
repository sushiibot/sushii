import { describe, expect, test } from "bun:test";

import { isTrivialMessage } from "./isTrivialMessage";

describe("isTrivialMessage", () => {
  const trivial: [string, string][] = [
    ["empty (sticker only)", ""],
    ["whitespace", "   \n "],
    ["unicode emoji", "😂😂"],
    ["zwj and skin tone emoji", "👩🏽‍💻 👍🏻"],
    ["keycap emoji", "1️⃣"],
    ["custom emoji", "<:pepe:123>"],
    ["animated emoji", "<a:dance:123456789012345678>"],
    ["user mention", "<@123>"],
    ["nickname mention", "<@!123456789012345678>"],
    ["role mention", "<@&123456789012345678>"],
    ["channel mention", "<#123456789012345678>"],
    ["punctuation", "!!!"],
    // Accepted trade-off: regional indicators are symbols, not letters.
    ["regional indicator letters", "🇫 🇷 🇪 🇪"],
    ["zero-width only", "​‌‍﻿"],
  ];

  const notTrivial: [string, string][] = [
    ["bare scam link", "https://dlscord-gift.com/nitro"],
    ["mention plus link", "<@&123456789012345678> https://x.ru/y"],
    ["dash command", "-fishy"],
    ["dot command", ".kys"],
    ["bang command", "!free nitro"],
    ["plus prefix", "+18 pics"],
    ["dollar prefix", "$50 dm me"],
    ["circled letters", "ⓕⓡⓔⓔ ⓝⓘⓣⓡⓞ"],
    ["negative squared letters", "🅵🆁🅴🅴"],
    ["fullwidth letters", "ｆｒｅｅ"],
    ["korean", "안녕하세요"],
    ["japanese", "こんにちは"],
    ["short word", "gn"],
    ["digits", "12"],
    ["emoji plus word", "😭 why"],
  ];

  test.each(trivial)("trivial: %s", (_name, content) => {
    expect(isTrivialMessage(content)).toBe(true);
  });

  test.each(notTrivial)("not trivial: %s", (_name, content) => {
    expect(isTrivialMessage(content)).toBe(false);
  });
});
