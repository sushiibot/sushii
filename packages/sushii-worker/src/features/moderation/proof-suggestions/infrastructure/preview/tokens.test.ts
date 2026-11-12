import { describe, expect, test } from "bun:test";

import {
  type Measure,
  shortenFileName,
  stripBidiControls,
  tokenizeContent,
  wrapTokens,
} from "./tokens";

const measure: Measure = (_kind, text) => [...text].length * 8;

describe("tokenizeContent", () => {
  test("never carries spoiler text into tokens or wrapped runs", () => {
    const secret = "the hidden grabify link";
    const tokens = tokenizeContent(
      `look ||${secret}|| and ||**${secret}** <@123>||`,
      [],
      false,
    );
    const runs = wrapTokens(measure, tokens, 120, 6).flat();

    expect(tokens.filter((t) => t.kind === "spoiler")).toHaveLength(2);
    for (const piece of [...tokens, ...runs]) {
      expect(piece.text).not.toContain("hidden");
      expect(piece.text).not.toContain("grabify");
    }
  });

  test("draws mentions as generic pills without ids", () => {
    const tokens = tokenizeContent(
      "<@123> <@!456> <@&789> <#111> </ban user:222> @everyone",
      [],
      false,
    );
    expect(
      tokens.filter((t) => t.kind === "mention").map((t) => t.text),
    ).toEqual([
      "@user",
      "@user",
      "@role",
      "#channel",
      "/ban user",
      "@everyone",
    ]);
  });

  test("shows custom emoji as :name: and strips markdown markers", () => {
    const tokens = tokenizeContent(
      "# **bold** *it* __under__ ~~gone~~ <a:wave:123456789>",
      [],
      false,
    );
    const text = tokens.map((t) => t.text).join("");
    expect(text).toBe("bold it under gone :wave:");
  });

  test("keeps urls intact including underscores, and masked link labels", () => {
    const tokens = tokenizeContent(
      "go **https://evil.example/a_b_c** or [click](https://x.example)",
      [],
      false,
    );
    expect(tokens.filter((t) => t.kind === "link").map((t) => t.text)).toEqual([
      "https://evil.example/a_b_c",
      "click",
    ]);
  });

  describe("masked links show their destination", () => {
    const linkTokens = (content: string) =>
      tokenizeContent(content, [], false).filter((t) => t.kind !== "text");

    test("plain label gets the host after it", () => {
      expect(linkTokens("[click here](https://www.X.example/a?b)")).toEqual([
        { kind: "link", text: "click here" },
        { kind: "muted", text: " (x.example)" },
      ]);
    });

    test.each([
      [
        "[https://discord.com/nitro](https://evil.example/steal)",
        "evil.example",
      ],
      ["[discord.com](https://evil.example)", "evil.example"],
      [
        "[https://discord.com](https://discord.com@evil.example/)",
        "evil.example",
      ],
      ["[discord.com](https://dіscord.com)", "xn--dscord-pvf.com"],
    ])("URL-looking label for another host warns: %s", (content, host) => {
      const tokens = linkTokens(content);
      expect(tokens.at(-1)).toEqual({
        kind: "warning",
        text: ` ⚠ goes to ${host}`,
      });
    });

    test("URL-looking label for the same host needs no suffix", () => {
      expect(
        linkTokens("[https://www.discord.com/a](https://discord.com/b)"),
      ).toEqual([{ kind: "link", text: "https://www.discord.com/a" }]);
    });

    test.each(["**discord.com**", "__discord.com__"])(
      "emphasized label %s for the same host doesn't warn",
      (label) => {
        expect(linkTokens(`[${label}](https://discord.com/x)`)).toEqual([
          { kind: "link", text: "discord.com" },
        ]);
      },
    );

    test("bidi controls can't flip a label into another domain", () => {
      const tokens = linkTokens(
        `[${stripBidiControls("\u202Emoc.drocsid")}](https://evil.com)`,
      );
      expect(tokens[0]).toEqual({ kind: "link", text: "moc.drocsid" });
      expect(stripBidiControls("a\u202Eb\u2066c\u200Fd")).toBe("abcd");
    });

    test("a long host keeps its end, where the real domain is", () => {
      const host = `discord.com.${"a".repeat(60)}.evil.io`;
      const tokens = linkTokens(`[free nitro](https://${host}/x)`);
      const suffix = tokens.at(-1)?.text ?? "";
      expect(suffix).toEndWith("evil.io)");
      expect(suffix).toStartWith(" (…");
    });

    test("a lookalike label for the same lookalike host still warns", () => {
      expect(
        linkTokens("[dіscord.com](https://dіscord.com/gift)").at(-1),
      ).toEqual({ kind: "warning", text: " ⚠ goes to xn--dscord-pvf.com" });
    });

    test("caps long labels so the destination survives wrapping", () => {
      const tokens = linkTokens(`[${"a ".repeat(200)}](https://evil.example)`);
      expect([...tokens[0].text].length).toBeLessThanOrEqual(60);
      expect(tokens[1]).toEqual({ kind: "muted", text: " (evil.example)" });
    });
  });

  test("keeps code text verbatim without parsing mentions inside it", () => {
    const tokens = tokenizeContent("```js\nfoo <@1>\n```", [], false);
    expect(tokens).toEqual([{ kind: "text", text: "foo <@1>" }]);
  });

  describe("spoilers win over code spans", () => {
    const secret = "grabify";
    const cases = [
      `||before \`${secret}\` after||`,
      `||\`\`\`\n${secret}\n\`\`\`||`,
      `||\`\`\`js\n${secret}\n\`\`\`||`,
      `\`a\` ||${secret}|| \`b\``,
      // Discord would show this as code; hiding it is the safe direction.
      `\`||${secret}||\``,
      `> ||quoted ${secret}\nnext||`,
    ];
    for (const content of cases) {
      test(JSON.stringify(content), () => {
        const tokens = tokenizeContent(content, [], false);
        const runs = wrapTokens(measure, tokens, 120, 6).flat();
        expect(tokens.some((t) => t.kind === "spoiler")).toBe(true);
        for (const piece of [...tokens, ...runs]) {
          expect(piece.text).not.toContain(secret);
        }
      });
    }

    test("hides a spoiler that closes past the content budget", () => {
      const content = `${"a ".repeat(40)}||${"s".repeat(30)} ${secret}||`;
      const tokens = tokenizeContent(content, [], false, 90);
      expect(tokens.map((t) => t.text).join("")).not.toContain(secret);
      expect(tokens.some((t) => t.kind === "spoiler")).toBe(true);
    });
  });

  test("drops content past the budget and marks the cut", () => {
    const tokens = tokenizeContent("😀".repeat(50), [], false, 10);
    expect(tokens).toEqual([
      { kind: "text", text: "😀".repeat(10) },
      { kind: "muted", text: "…" },
    ]);
  });

  test("keeps newlines and adds attachment chips", () => {
    const tokens = tokenizeContent("a\nb", ["x.png"], true);
    expect(tokens.map((t) => t.kind)).toEqual([
      "text",
      "newline",
      "text",
      "text",
      "file",
    ]);
    expect(tokens.at(-1)?.text).toBe("📎 x.png (deleted)");
    expect(tokenizeContent("", ["y.png"], false)).toEqual([
      { kind: "file", text: "📎 y.png" },
    ]);
  });

  test("shortens long attachment names in the middle, keeping the extension", () => {
    const name = `${"f".repeat(200)}0.png`;
    const short = shortenFileName(name);
    expect([...short].length).toBe(40);
    expect(short.endsWith("ff0.png")).toBe(true);
    expect(short).toContain("…");
    expect(shortenFileName("short.png")).toBe("short.png");
    expect(tokenizeContent("", [name], true)).toEqual([
      { kind: "file", text: `📎 ${short} (deleted)` },
    ]);
  });

  test("hides the names of SPOILER_ attachments", () => {
    const tokens = tokenizeContent(
      "",
      ["SPOILER_secret_plan.png", "spoiler_ok.png"],
      false,
    );
    expect(tokens.map((t) => t.text)).toEqual([
      "📎 spoiler file",
      "📎 spoiler_ok.png",
    ]);
    expect(JSON.stringify(tokens)).not.toContain("secret");
  });

  test("marks empty messages", () => {
    expect(tokenizeContent("", [], false)).toEqual([
      { kind: "muted", text: "(no text)" },
    ]);
  });
});

describe("wrapTokens", () => {
  test("bounds measuring work for huge unbroken messages", () => {
    let calls = 0;
    const counting: Measure = (kind, text) => {
      calls += 1;
      return measure(kind, text);
    };
    const tokens = tokenizeContent("A".repeat(4000), [], false);
    const lines = wrapTokens(counting, tokens, 474, 6);

    expect(lines).toHaveLength(6);
    expect(lines[5].at(-1)?.text).toBe("…");
    expect(calls).toBeLessThan(150);
  });

  test("keeps the first line within a narrower first-line width", () => {
    const tokens = tokenizeContent("word ".repeat(40), [], false);
    const lines = wrapTokens(measure, tokens, 200, 6, 120);
    const width = (i: number) =>
      lines[i].reduce((sum, run) => sum + run.width, 0);
    expect(width(0)).toBeLessThanOrEqual(120);
    expect(width(1)).toBeGreaterThan(120);
    expect(width(1)).toBeLessThanOrEqual(200);

    const single = wrapTokens(
      measure,
      tokenizeContent("x".repeat(40), [], false),
      400,
      1,
      120,
    );
    expect(
      single[0].reduce((sum, run) => sum + run.width, 0),
    ).toBeLessThanOrEqual(120);
  });

  test("breaks long unbroken tokens by character", () => {
    const tokens = tokenizeContent("x".repeat(50), [], false);
    const lines = wrapTokens(measure, tokens, 80, 10);
    expect(lines).toHaveLength(5);
    for (const line of lines) {
      expect(line.reduce((sum, run) => sum + run.width, 0)).toBeLessThanOrEqual(
        80,
      );
    }
  });

  test("caps lines and ends with an ellipsis", () => {
    const tokens = tokenizeContent(
      Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n"),
      [],
      false,
    );
    const lines = wrapTokens(measure, tokens, 400, 6);
    expect(lines).toHaveLength(6);
    expect(lines[5].at(-1)?.text).toBe("…");
  });
});
